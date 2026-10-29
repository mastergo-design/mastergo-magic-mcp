/**
 * E2E 驱动：以「LLM 角色」按 pageRestore 编排指令驱动真实工具链路。
 *
 * 用法（本地，不进 CI）：
 *   NODE_PATH=<master-web>/node_modules \
 *   MG_MCP_TOKEN=<prod token> API_BASE_URL=https://mastergo.com \
 *   E2E_FILE_ID=xxx E2E_PAGE_ID=M E2E_OUT=/tmp/out [E2E_SMOKE=1] [E2E_MAX_LAYERS=3] \
 *   node .test/e2e-driver.cjs
 *
 * 验证点：
 * 1. getPageLayers 真实响应 → 自动建计划（pageRestore.firstLayerId + nextAction）
 * 2. 逐层 getDesignSections → pageRestore.position 注入
 * 3. 每层 applyDesign → pageRestore.next 接力（LAYER_DONE → COMPLETE）
 * 4. 最终 COMPLETE 且文件落盘
 *
 * HTML 由确定性渲染器从真实 DSL 生成（结构级还原：flex/绝对定位/文本/SVG 占位），
 * 图片用占位块——还原像素保真度不是本驱动的验收目标（那是既有工作流的验收点）。
 */
import fs from "node:fs";
import path from "node:path";
import { GetPageLayersTool } from "../../src/tools/get-page-layers";
import { GetDesignSectionsTool } from "../../src/tools/get-design-sections";
import { ApplyDesignTool } from "../../src/tools/apply-design";

const FILE_ID = process.env.E2E_FILE_ID || "";
const PAGE_ID = process.env.E2E_PAGE_ID || "M";
const OUT = process.env.E2E_OUT || "/tmp/mg-e2e-out";
const SMOKE = process.env.E2E_SMOKE === "1";
const MAX_LAYERS = parseInt(process.env.E2E_MAX_LAYERS || "0", 10);
const CONCURRENCY = Math.max(1, parseInt(process.env.E2E_CONCURRENCY || "3", 10));
const ONLY_LAYER = process.env.E2E_ONLY_LAYER || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 服务端 10001 限流兜底：退避重试（仅 e2e 驱动使用）。 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (!msg.includes("10001") && !msg.includes("请求超限")) throw e;
      const wait = attempt * 5000;
      console.log(`  [rate-limit] ${label} attempt ${attempt}, wait ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

if (!FILE_ID) {
  console.error("E2E_FILE_ID is required");
  process.exit(1);
}

function parseText(resp: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(resp.content[0].text);
}

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function nodeText(node: any): string {
  if (node._placeholder === true) return "";
  const t = node.text;
  if (typeof t === "string") return esc(t);
  if (Array.isArray(t)) return esc(t.map((x: any) => (typeof x === "string" ? x : x?.text ?? "")).join(""));
  return "";
}

/** 确定性 DSL→HTML：flex 容器流式、叶子绝对定位、PATH 用占位符。 */
function renderNode(node: any, inFlex: boolean): string {
  if (!node || typeof node !== "object") return "";
  const layout = node.layoutStyle || {};
  const w = layout.width != null ? `width:${layout.width}px;` : "";
  const h = layout.height != null ? `height:${layout.height}px;` : "";
  const flex = node.flexContainerInfo;
  const color = node._color ? `color:${node._color};background-color:${node._color};` : "";

  let style = "";
  if (inFlex) {
    style = `${w}${h}${flex ? "" : ""}`;
    if (!flex) style += `flex-shrink:0;`;
  } else {
    style = `position:absolute;${layout.relativeX != null ? `left:${layout.relativeX}px;` : ""}${layout.relativeY != null ? `top:${layout.relativeY}px;` : ""}${w}${h}`;
  }
  if (flex) {
    style += `display:flex;flex-direction:${flex.flexDirection || "row"};`;
    if (flex.justifyContent) style += `justify-content:${flex.justifyContent};`;
    if (flex.alignItems) style += `align-items:${flex.alignItems};`;
    if (flex.gap) style += `gap:${flex.gap};`;
    if (flex.padding) style += `padding:${flex.padding};`;
    if (flex.flexWrap) style += `flex-wrap:${flex.flexWrap};`;
    style += "box-sizing:border-box;";
  }
  if (node.opacity != null && node.opacity !== 1) style += `opacity:${node.opacity};`;
  if (color && !flex) style += color;

  const kids = Array.isArray(node.children)
    ? node.children.map((c: any) => renderNode(c, Boolean(flex))).join("")
    : "";

  if (node.type === "PATH" || node.svgShortKey) {
    return `<span style="${style}display:flex;align-items:center;justify-content:center;overflow:hidden">@@SVG:${node.svgShortKey}@@</span>`;
  }
  if (node.type === "IMAGE") {
    return `<div style="${style}background:#eee;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999" title="${esc(node.name)}">IMG</div>`;
  }
  if (node.type === "TEXT") {
    const text = nodeText(node);
    return `<div style="${style}${text ? "" : ""}box-sizing:border-box;">${text}</div>`;
  }
  return `<div style="${style}box-sizing:border-box;">${kids}</div>`;
}

function renderPage(list: any, dsls: any[]): string {
  const root = list.rootContainer || {};
  const rootStyle =
    `position:relative;width:${root.width || "auto"};min-height:${root.minHeight || "auto"};` +
    `background:${root.background || "transparent"};overflow:hidden;`;
  const sectionsHtml = dsls
    .map((d, i) => {
      const meta = list.sections?.[i] || {};
      const rootNode = d?.dsl?.nodes?.[0];
      if (!rootNode) return `<!-- section ${i} empty -->`;
      const inner = renderNode(rootNode, false);
      const pos = `position:absolute;left:${meta.x ?? 0}px;top:${meta.y ?? 0}px;`;
      const widthVal = meta.width ?? rootNode.layoutStyle?.width;
      const size = widthVal != null ? `width:${widthVal}px;` : "";
      return `<div style="${pos}${size}">${inner}</div>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>e2e page restore</title></head>
<body style="margin:0">
<div style="${rootStyle}">
${sectionsHtml}
</div>
</body></html>`;
}

async function fetchAllSections(fileId: string, layerId: string, total: number): Promise<any[]> {
  const dsls: any[] = new Array(total);
  for (let start = 0; start < total; start += CONCURRENCY) {
    const idxs: number[] = [];
    for (let i = start; i < Math.min(start + CONCURRENCY, total); i++) idxs.push(i);
    const results = await Promise.all(
      idxs.map(async (i) => {
        const resp = parseText(await withRateLimitRetry(
          () => new GetDesignSectionsTool().execute({ fileId, layerId, sectionIndex: i }),
          `section ${i}`,
        ));
        if (resp.error) throw new Error(`section ${i} failed: ${JSON.stringify(resp).slice(0, 200)}`);
        return [i, resp] as const;
      }),
    );
    for (const [i, resp] of results) dsls[i] = resp;
    process.stdout.write(`    sections ${Math.min(start + CONCURRENCY, total)}/${total}\n`);
  }
  return dsls;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`[e2e] fileId=${FILE_ID} pageId=${PAGE_ID} out=${OUT} smoke=${SMOKE}`);

  // Step 1: 枚举（LLM 视角：pageRestore 指令驱动后续步骤）
  console.log("[step1] getPageLayers ...");
  const pageLayers = parseText(await new GetPageLayersTool().execute({ fileId: FILE_ID, layerId: PAGE_ID }));
  if (pageLayers.error) {
    console.error("ENUM ERROR:", JSON.stringify(pageLayers).slice(0, 500));
    process.exit(2);
  }
  console.log(`[step1] page="${pageLayers.pageName}" totalLayers=${pageLayers.totalLayers}`);
  for (const l of pageLayers.layers) console.log(`  - ${l.name} (${l.id}) [${l.type}] ${l.childrenCount} kids`);
  console.log("[step1] pageRestore.plan =", JSON.stringify(pageLayers.pageRestore));
  console.log("[step1] nextAction =", pageLayers.nextAction?.slice(0, 200));

  if (pageLayers.needsCanvasVisit) {
    console.log("[e2e] page not cached & no canvas data — visit canvas first. STOP.");
    process.exit(3);
  }

  const layers = MAX_LAYERS > 0 ? pageLayers.layers.slice(0, MAX_LAYERS) : pageLayers.layers;
  if (SMOKE) {
    console.log(`[smoke] first layer list: ${layers[0]?.id}`);
    const list = parseText(await new GetDesignSectionsTool().execute({ fileId: FILE_ID, layerId: layers[0].id }));
    console.log("[smoke] totalSections =", list.totalSections);
    console.log("[smoke] pageRestore =", JSON.stringify(list.pageRestore));
    console.log("[smoke] OK — orchestration signals present. (E2E_SMOKE=1 stops here)");
    return;
  }

  // Step 2: 逐层还原（顺序，一层一层来——与 pageRestore 指令一致）
  const layersFiltered = ONLY_LAYER ? layers.filter((l: any) => l.id === ONLY_LAYER) : layers;
  if (ONLY_LAYER && layersFiltered.length === 0) {
    console.error(`[e2e] E2E_ONLY_LAYER=${ONLY_LAYER} not found in page layers`);
    process.exit(4);
  }
  const manifest: any[] = [];
  let index = 0;
  for (const layer of layersFiltered) {
    index++;
    console.log(`[layer ${index}/${layersFiltered.length}] ${layer.name} (${layer.id})`);
    const list = parseText(await withRateLimitRetry(
      () => new GetDesignSectionsTool().execute({ fileId: FILE_ID, layerId: layer.id }),
      `list ${layer.id}`,
    ));

    if (list.error === "LAYER_SKIPPED_IN_PAGE_RESTORE") {
      console.log(`  SKIPPED (10017): ${list.pageRestore?.progress}`);
      manifest.push({ layerId: layer.id, name: layer.name, status: "skipped" });
      continue;
    }
    if (list.error) {
      console.log(`  LIST ERROR:`, JSON.stringify(list).slice(0, 300));
      manifest.push({ layerId: layer.id, name: layer.name, status: "error" });
      continue;
    }
    if (typeof list.totalSections !== "number") {
      // 服务端业务错误（如 10001 限流）以 {code,message} 形态返回，无 totalSections
      console.log(`  LIST BUSINESS ERROR:`, JSON.stringify(list).slice(0, 300));
      manifest.push({ layerId: layer.id, name: layer.name, status: "error", code: list.code });
      continue;
    }
    console.log(`  totalSections=${list.totalSections}`);
    const dsls = await fetchAllSections(FILE_ID, layer.id, list.totalSections);
    const html = renderPage(list, dsls);

    const fileName = `${String(layer.name || "layer").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "layer"}-${layer.id.split(":").pop()}.html`;
    const applyResp = parseText(await new ApplyDesignTool().execute({
      fileId: FILE_ID,
      layerId: layer.id,
      code: html,
      outDir: OUT,
      outputFileName: fileName,
    }));
    if (applyResp.error || !applyResp.filePath) {
      console.log(`  APPLY DEBUG resp: ${JSON.stringify(applyResp).slice(0, 600)}`);
      console.log(`  APPLY code head: ${html.slice(0, 200).replace(/\n/g, " ")}`);
    }
    const pr = applyResp.pageRestore || {};
    console.log(`  written: ${applyResp.filePath}`);
    console.log(`  pageRestore: status=${pr.status} next=${pr.nextLayerId} nextFile=${pr.nextFileName}`);
    manifest.push({
      layerId: layer.id, name: layer.name, status: "done",
      file: applyResp.filePath,
      orchestration: pr.status || "(none)",
    });
  }

  // Step 3: 汇总
  const doneCount = manifest.filter((m) => m.status === "done").length;
  console.log("\n===== E2E SUMMARY =====");
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`[e2e] ${doneCount}/${layers.length} layers restored. Expected COMPLETE on the last one.`);
}

main().catch((e) => {
  console.error("[e2e] FATAL:", e?.message || e);
  process.exit(1);
});
