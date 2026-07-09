import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";
import { markSectionWorkflowActive, setTotalSections, trackSectionFetched } from "./get-dsl";

const DESIGN_SECTIONS_TOOL_NAME = "mcp__getDesignSections";
const DESIGN_SECTIONS_TOOL_DESCRIPTION = `
[PRIMARY] This is the main tool for all designs. Operates in TWO modes:

Mode 1 — Get layout overview (sectionIndex NOT provided):
Returns the list of all sections with id, name, type, nodeCount, textPreview (first TEXT node, 20 chars max), and a page-absolute bounding box (x, y, width, height) for each section, plus totalSections and totalNodes.
Also returns rootMetadata (root layer width/height/name/type/fill) when available. rootContainer CSS properties for the page wrapper. splitContainers for large page regions that were split into child sections.
Use this FIRST to understand the design scope. The per-section bbox tells you exactly where each section sits inside the root container — use it for absolute positioning when generating code.
Example: { "fileId": "123", "layerId": "456:789" }

Mode 2 — Get section DSL (sectionIndex provided):
Returns the full DSL for ONE specific section.
- PATH nodes come in TWO forms. (1) INLINED: most PATH nodes carry an \`svg\` field with the complete \`<svg>...</svg>\` string — copy it VERBATIM, no transformation needed. (2) STRIPPED: large sections strip SVGs to a cache; these PATH nodes carry a \`svgKey\` field AND a \`path\` array with empty \`data\`. For stripped nodes, call mcp__getDesignSvgs to get the svgHtml. ALWAYS check \`svg\` first; if absent, use \`svgKey\` to fetch.
- CRITICAL: When a section response has \`hasStrippedSvgs: true\`, its PATH \`data\` is empty and SVG items use \`@svgCache:\` keys. You MUST call \`mcp__getDesignSvgs\` with the same fileId/layerId to retrieve the actual SVG HTML. Skipping this step WILL cause missing icons (logos, pagination arrows, table action buttons, etc.).
- INSTANCE nodes with a \`_variantProps\` object carry semantic state labels. Compare these across sibling instances to determine active/selected/hovered states — do NOT default to the first item.

CRITICAL — sectionIndex is SINGULAR: the parameter is sectionIndex (a SINGLE integer per call). There is NO plural sectionIndices parameter — passing an array will be rejected with an error. To fetch multiple sections you MUST make multiple calls, each with one sectionIndex.

IMPORTANT workflow:
1. First call WITHOUT sectionIndex to get the section list with node counts.
2. Then call WITH sectionIndex=0, then sectionIndex=1, ... up to totalSections-1 — ONE sectionIndex per call.
3. YOU MUST REQUEST ALL SECTIONS. Do NOT skip any section index — missing sections WILL cause missing content.
4. textPreview helps distinguish same-looking sections: "系统信息", "权限设置", "基本设置" — all may have nodeCount=3 and empty name but DIFFERENT textPreview. They are individual menu items, NOT duplicates.
5. Fetch sections in batches of 3-5 CONCURRENT calls (3-5 separate single-sectionIndex calls in parallel), wait for all results, then send the next batch. Each call has exactly one sectionIndex.
6. After fetching all sections, handle SVGs: inlined PATH nodes use their \`svg\` field directly; for stripped PATH nodes (those with \`svgKey\`), call mcp__getDesignSvgs to get SVG icons.
7. Count your requests. If totalSections=48, you must make exactly 48 sectionIndex calls (each with a SINGLE integer). Keep a checklist and do NOT stop early.
8. Generate the complete HTML with all SVG data.

DO NOT call mcp__getDsl after completing this workflow — all data is already provided.
If this tool returns an error (e.g. old server), fall back to mcp__getDsl.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

/**
 * DSL 还原规则。HTTP 后端 (frontend-mcp-server) 在 section list 响应里会下发一份完整的；
 * 但部分旧版后端或 HTTP route 路径不下发 rules。当后端响应缺 rules 时，由 magic-mcp 在此补全，
 * 保证 LLM 无论连哪个后端版本，都能拿到完整的还原规则（SVG/文本/行数/定位等）。
 * 必须与 frontend-mcp-server/src/mcp-sse/tools/get-design-sections.ts 的 DSL_RULES 保持同步。
 */
const DSL_RULES: string[] = [
    "CRITICAL — Page positioning: the section LIST response contains splitContainers with page-absolute coordinates for each page region. Use splitContainers to construct the page skeleton (position:absolute with exact coordinates). Do NOT guess or stack with flex. IMPORTANT: splitContainers x/y are the container's absolute position on the canvas — they are NOT CSS margins/padding for child elements. Do NOT apply a container's y coordinate as top/margin-top on the main content wrapper. The main content area should start at top:0 within its own positioning context; sub-sections inside it use their own bbox y coordinates relative to the container, not to the page root.",
    "CRITICAL — Multi-column sidebar layout: render ALL sidebar levels as persistent visible columns positioned via splitContainers coordinates. Do NOT use position:absolute/fixed for submenu panels (they become floating overlays and break the main content width). Instead, lay out ALL columns (primary sidebar + submenu + main content) side-by-side using flex or absolute positioning that ACCOUNTS for every column's width. The main content area width = rootContainer.width minus ALL sidebar column widths. Do NOT use flex:1 for main content when there are multiple sidebar columns — it will expand into the submenu's space. Each sidebar column's width comes from its splitContainer entry.",
    "token filed must be generated as a variable (colors, shadows, fonts, etc.) and the token field must be displayed in the comment",
    "componentDocumentLinks is a list of frontend component documentation links. When it exists and is not empty, use mcp__getComponentLink to get the documentation.",
    "",
    "CRITICAL — SVG FROM PATH NODES (MUST FOLLOW): Each PATH node has EITHER a `svg` field (inline mode — contains the complete `<svg>...</svg>` string, copy VERBATIM) OR a `svgKey` field (cache mode — SVG too large to inline, stored in a cache). When you see `svgKey`: (a) section has `hasStrippedSvgs: true`; (b) MUST call mcp__getDesignSvgs with same fileId/layerId; (c) use resolvedIcons[{sectionIndex}][{iconName}] -> svgs[svgKey] to get the svgHtml. NEVER leave a PATH node unrendered — every icon MUST appear in HTML. PRESERVE ALL attributes on each <path> tag — especially fill-rule=\"evenodd\" (controls hole-punching in compound paths). FORBIDDEN MODIFICATIONS to path data: (1) NEVER truncate decimal precision; (2) NEVER change curve commands; (3) NEVER substitute a different icon; (4) NEVER round or simplify coordinates.",
    "CRITICAL — RENDER EVERY ICON IN PATH NODES: Every PATH node has either a `svg` field (inline, copy VERBATIM) or a `svgKey` field (cache, call getDesignSvgs). Do NOT skip any PATH node — sidebar menu icons, table header sort/filter/search icons, pagination prev/next/refresh icons, and action buttons all MUST appear as rendered <svg> elements. A header cell or menu item showing only plain text is a fidelity defect.",
    "",
    "CRITICAL — _placeholder TEXT handling: TEXT nodes with `_placeholder: true` (name==text) are listed in `dsl.placeholderTexts`. These are component-library boilerplate — NOT real column headers, labels, or data. Do NOT render them as table headers, column names, or visible UI labels. They appear alongside real text in the same section (e.g. a header cell has both realTitle='用户名称' and placeholder='Hillstone Design') — render ONLY the real title, omit the placeholder. EXCEPTION: if a placeholder text is the SOLE text in its section AND it reads as a legitimate brand name or page title (e.g. '智源智能安全运营平台'), it may be real content — render it in its proper context (logo area, page title), never as a table header.",
    "CRITICAL — CLOSED-SET TEXT: the section LIST response carries `rootMetadata.allTexts` — the complete whitelist of text strings in this design (including placeholder strings). Any visible string NOT in allTexts is a hallucination and MUST be removed. Use `dsl.placeholderTexts` in each section to identify which strings are component-library boilerplate.",
    "",
    "CRITICAL — INSTANCE fill color: when an INSTANCE has both `fill` and `_color`, use `_color` directly as the CSS value. Do NOT guess colors from _variantProps semantics.",
    "CRITICAL — INSTANCE _variantProps: compare across siblings for selected/hovered/disabled. Active class MUST match DSL variant state, NOT a default index.",
    "CRITICAL — Render count = structureSiblingCount: if ssc=1, that single instance IS complete — do NOT fabricate extra rows/items.",
    "CRITICAL — BACKGROUND FROM splitContainers: splitContainers[].background IS the exact CSS background-color. Copy verbatim, no changes.",
    "CRITICAL — FRAME/GROUP opacity: translate to rgba() on background only, NOT CSS opacity (would make children translucent).",
    "CRITICAL — rowTexts: each entry has parentType/parentName for context and `_placeholder: true` if boilerplate. Use parentName to place text correctly; skip _placeholder entries. IMPORTANT: if a short numeric text (like '8') has parentName matching a button INSTANCE (e.g. '分类[a3]=文本按钮,类型[aI]=危险'), it is likely a badge/count indicator overlaid on that button — NOT part of the button label. Do NOT render it inside the button text; render it as a separate badge element positioned on the button corner, OR omit it if the design does not show a visible badge on that specific button instance.",
    "Render ALL nodes recursively. Section root layoutStyle.width = section width. Do not call mcp__getDsl after completing section workflow.",
    "CRITICAL — ICON-TO-NODE BINDING: match PATH nodes to their UI position by the node's ancestor name. A PATH node under a menu item belongs in that menu's icon slot; one under a button/refresh belongs in that button. NEVER substitute a memorized icon — copy the PATH node's svg field VERBATIM or call getDesignSvgs for stripped SVGs.",
    "CRITICAL — TEXT PROVENANCE SELF-CHECK: before finalizing output, verify every visible text string exists in allTexts. If you emit MORE distinct strings than allTexts.length, you are hallucinating. Typical hallucinations: fabricated table headers, invented data, brand tokens, generic labels not in the design.",
    "CRITICAL — DO NOT SKIP SECTION DSL FETCH: the section LIST response is ONLY a directory (id/name/nodeCount/textPreview). It does NOT contain DSL nodes, rowTexts, or any rendering data. You CANNOT generate correct HTML from the list alone. You MUST call mcp__getDesignSections with sectionIndex=0, then 1, ... up to totalSections-1 to get each section's DSL. Generating HTML without fetching ALL section DSLs will produce missing content (menus, table data, icons) and incorrect SVGs — this is the #1 cause of broken output.",
  ];


export class GetDesignSectionsTool extends BaseTool {
  name = DESIGN_SECTIONS_TOOL_NAME;
  description = DESIGN_SECTIONS_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    fileId: z
      .string()
      .optional()
      .describe(
        "MasterGo design file ID. Required if shortLink is not provided."
      ),
    layerId: z
      .string()
      .optional()
      .describe(
        "Root layer ID of the design. Required if shortLink is not provided."
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
    sourceLayerId: z
      .string()
      .optional()
      .describe(
        "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId for all queries."
      ),
    sectionIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "0-based section index (SINGULAR — a single integer per call). If omitted, returns the section list only. If provided, returns full DSL for that ONE specific section. To fetch multiple sections, make MULTIPLE separate calls each with a single sectionIndex. Do NOT pass an array."
      ),
    format: formatField(),
  }).passthrough();

  async execute({ fileId, layerId, shortLink, sourceLayerId, sectionIndex, format, ...rest }: z.infer<typeof this.schema>) {
    try {
      // 拦截 LLM 误用的复数参数 sectionIndices（schema 不声明它，但 passthrough 保留未知字段）。
      // 引导 LLM 改用单数 sectionIndex（每次一个，多次调用）。
      const sectionIndices = (rest as Record<string, unknown>).sectionIndices;
      if (sectionIndices !== undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Parameter 'sectionIndices' (plural) is NOT supported. Use 'sectionIndex' (SINGULAR — a single integer) instead. Make MULTIPLE separate calls, each with one sectionIndex (e.g. sectionIndex=15, then sectionIndex=16, ...). Passing an array will always return this error.",
              }),
            },
          ],
        };
      }

      if (!shortLink && (!fileId || (!layerId && !sourceLayerId))) {
        throw new Error(
          "Either provide fileId with layerId (or sourceLayerId), or provide a shortLink"
        );
      }

      let finalFileId = this.normalizeFileId(fileId);
      let finalLayerId = layerId;
      let finalSourceLayerId = sourceLayerId;

      if (shortLink) {
        const ids = await httpUtilInstance.extractIdsFromUrl(shortLink);
        finalFileId = this.normalizeFileId(ids.fileId);
        finalLayerId = ids.layerId;
        finalSourceLayerId = ids.sourceLayerId ?? sourceLayerId;
      }

      const effectiveLayerId = finalSourceLayerId || finalLayerId;
      if (!finalFileId || !effectiveLayerId) {
        throw new Error("Could not determine fileId or layerId (need layerId or sourceLayerId)");
      }

      const result = await httpUtilInstance.getDesignSections(
        finalFileId,
        effectiveLayerId,
        sectionIndex
      );

      // 部分后端（如旧版 HTTP route）在 section list 响应里不下发 rules。
      // 这里兜底补全：仅 section list 模式（无 sectionIndex）且响应缺 rules 时注入。
      // section DSL 模式（有 sectionIndex）的逐次规则强化由后端 BRIEF_RULES / 本工具主指令承担。
      if (
        sectionIndex === undefined &&
        result &&
        typeof result === "object" &&
        (!result.rules || !Array.isArray(result.rules) || result.rules.length === 0)
      ) {
        result.rules = DSL_RULES;
      }

      // section list 模式：在响应里注入 nextAction 显式指令，防止 LLM 跳过 section DSL 拉取。
      // 实测发现 LLM 拿到 section list 后可能直接生成 HTML（跳过所有 section DSL 请求），
      // 导致图标/菜单/表格数据全部缺失。nextAction 在数据层面强制提醒下一步操作。
      if (
        sectionIndex === undefined &&
        result &&
        typeof result === "object" &&
        typeof result.totalSections === "number" &&
        result.totalSections > 0
      ) {
        const n = result.totalSections;
        // 检测是否有 structureSiblingCount > 1 的 section 组（如 22 个子菜单项）
        let siblingWarning = '';
        const sections = Array.isArray(result.sections) ? result.sections : [];
        const highSiblingSections = sections.filter((s: any) => s && typeof s.structureSiblingCount === 'number' && s.structureSiblingCount > 1);
        if (highSiblingSections.length > 0) {
          const maxSibling = Math.max(...highSiblingSections.map((s: any) => s.structureSiblingCount));
          siblingWarning = ` WARNING: ${highSiblingSections.length} sections have structureSiblingCount up to ${maxSibling} — they look identical in the list (same nodeCount, empty name) but each has DIFFERENT text content and variant state. You MUST fetch ALL of them individually (do NOT skip any after fetching a few). Skipping sibling sections causes missing active-state styling and wrong menu item rendering.`;
        }
        result.nextAction = `STOP. This section LIST is only a directory — it has NO DSL nodes,  NO rowTexts. You CANNOT generate HTML from this list alone. Your NEXT ACTION: call mcp__getDesignSections with sectionIndex=0, then sectionIndex=1, ... up to sectionIndex=${n - 1} (total ${n} calls). Fetch ALL ${n} sections in batches of 3-5 before writing ANY HTML. Sections with nodeCount=3 and empty name are NOT empty — they contain real menu items and content (resolved from INSTANCE overrides during DSL transfer).${siblingWarning} Skipping section DSL fetch is the #1 cause of missing menus, broken icons, and wrong data.`;
        // 检测多列布局：动态计算主内容区位置
        const scList = result.splitContainers;
        if (Array.isArray(scList) && scList.length > 0) {
          const rootH = result.rootContainer?.minHeight ? parseInt(result.rootContainer.minHeight) : 900;
          const sidebarCols = scList.filter((sc: any) => sc && sc.height && sc.height >= rootH * 0.8 && sc.width && sc.width <= 300);
          if (sidebarCols.length >= 2) {
            const totalSidebarW = sidebarCols.reduce((sum: number, sc: any) => sum + (sc.width || 0), 0);
            const rootW = result.rootContainer?.width ? parseInt(result.rootContainer.width) : 1440;
            const mainX = totalSidebarW;
            const mainW = rootW - totalSidebarW;
            const colNames = sidebarCols.map((sc: any) => sc.name || sc.id).join(', ');
            result.nextAction += ` LAYOUT: ${sidebarCols.length} sidebar columns detected (${colNames}), total width=${totalSidebarW}px. Main content must start at x=${mainX} with width=${mainW}px. Do NOT let main content expand into sidebar space (no flex:1 without explicit max-width).`;
          }
        }
      }

      // 标记 section 工作流已激活：后续 getDsl 调用将被拦截（防止 195KB 全量数据撑爆上下文）。
      if (sectionIndex === undefined) {
        markSectionWorkflowActive(finalFileId, effectiveLayerId);
        // 记录总数，供后续 section DSL 响应计算 fetchProgress
        if (result && typeof result === "object" && typeof result.totalSections === "number") {
          setTotalSections(finalFileId, effectiveLayerId, result.totalSections);
        }
      }

      // section DSL 模式：注入 fetchProgress 持续提醒 LLM 还剩多少未拉取。
      // 实测发现 LLM 在拉取中途（如 15/48 或 20/48）停止，即使 nextAction/siblingWarning 到位。
      // 在每次 section DSL 响应里动态注入进度，让 LLM 始终看到"还有 N 个未拉取"。
      if (
        sectionIndex !== undefined &&
        result &&
        typeof result === "object"
      ) {
        const progress = trackSectionFetched(finalFileId, effectiveLayerId, sectionIndex);
        if (progress && progress.remaining > 0) {
          const missingStr = progress.missingIndices.length <= 15
            ? `[${progress.missingIndices.join(",")}]`
            : `[${progress.missingIndices.slice(0, 10).join(",")}... +${progress.missingIndices.length - 10} more]`;
          result.fetchProgress = `Fetched ${progress.fetched}/${progress.total}. MISSING ${progress.remaining} sections: ${missingStr}. You MUST fetch ALL remaining sections before generating HTML. Do NOT stop early.`;
        } else if (progress && progress.remaining === 0) {
          result.fetchProgress = `ALL ${progress.total} sections fetched. You can now generate the complete HTML.`;
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(result, format),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error.response?.data ?? error?.message;
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(errorMessage),
          },
        ],
      };
    }
  }
}
