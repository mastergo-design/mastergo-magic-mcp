/**
 * 整页多图层还原的客户端编排状态机（进程级，stdio 长驻）。
 *
 * 背景：多图层还原工作流（getPageLayers 枚举 → 逐层 getDesignSections → applyDesign
 * → 下一层）此前完全靠 SERVER_INSTRUCTIONS 的一次性指令 + 用户手动组织，LLM 常见
 * 失败模式：枚举后只还原第一层就宣称完成、跳层、把多层合并进一个 HTML、中途停止。
 * 单图层内的 section 工作流已有同款治理（get-dsl.ts 的 sectionWorkflow 跟踪器 +
 * 服务端 fetchProgress 注入），本模块把该机制提升到「整页 layer 级」。
 *
 * 角色分工：
 * - 服务端（frontend-mcp-server）多 pod 无状态，不承载跨图层状态；
 * - magic-mcp 客户端是 stdio 长驻进程，每次工具调用都经过它 —— 由它维护
 *   「整页计划 + 每层完成态」，并在工具响应里动态注入 pageRestore 指令。
 *
 * 内存安全：与 get-dsl.ts 的 sectionWorkflow 三容器同款护栏 —— 硬上限 LRU 淘汰 +
 * TTL 兜底定时清理（LLM 不调 applyDesign / 工作流放弃时 key 只写不删）。
 */

/** 单个待还原图层。 */
export interface PlannedLayer {
  /** 图层 id（getPageLayers 返回的 layer.id，可作为 ?layer_id=）。 */
  layerId: string;
  /** 图层名（用于建议输出文件名）。 */
  name: string;
  /** MCP 口径图层类型（FRAME/COMPONENT/COMPONENT_SET/INSTANCE/SECTION）。 */
  type: string;
}

/** 单层状态。 */
type LayerStatus = "pending" | "in_progress" | "done" | "failed";

/** 一个页（或父容器）的还原计划。 */
interface PageRestorePlan {
  fileId: string;
  /** 枚举时的 page/容器 layerId（仅用于诊断）。 */
  pageLayerId: string;
  pageName?: string;
  layers: PlannedLayer[];
  statuses: LayerStatus[];
  /** 建议的输出目录（首个 applyDesign 传入 outDir 时回填，后续层复用）。 */
  outDir?: string;
  createdAt: number;
  updatedAt: number;
}

/** TTL：整页还原可能很长（几十层 × 每层几十 section），TTL 过短会误清进行中计划。 */
const PLAN_TTL_MS = parseInt(process.env.PAGE_RESTORE_PLAN_TTL_MS || "3600000", 10);
/** 硬上限：同时跟踪的页计划数（超容 LRU 淘汰最旧）。 */
const PLAN_MAX_ENTRIES = parseInt(process.env.PAGE_RESTORE_PLAN_MAX_ENTRIES || "64", 10);

const plans = new Map<string, PageRestorePlan>();

function planKey(fileId: string, pageLayerId: string): string {
  return `${fileId}:${pageLayerId}`;
}

/** LRU 写入：已有 key 先 delete 再 set；超容量淘汰最旧。 */
function touchPlan(key: string, plan: PageRestorePlan): void {
  plan.updatedAt = Date.now();
  plans.delete(key);
  plans.set(key, plan);
  while (plans.size > PLAN_MAX_ENTRIES) {
    const oldest = plans.keys().next().value;
    if (oldest === undefined) break;
    plans.delete(oldest);
  }
}

/** 覆盖语义：同 fileId+pageLayerId 重新枚举 → 重建计划（保留已完成层，便于断点续跑）。 */
export function startPageRestore(
  fileId: string,
  pageLayerId: string,
  layers: PlannedLayer[],
  pageName?: string,
): void {
  if (layers.length === 0) return;
  const key = planKey(fileId, pageLayerId);
  const prev = plans.get(key);
  // 断点续跑：重新枚举后同 layerId 的已完成态保留，其余重置 pending。
  const prevDone = new Set<string>();
  if (prev) {
    prev.layers.forEach((l, i) => {
      if (prev.statuses[i] === "done") prevDone.add(l.layerId);
    });
  }
  const statuses = layers.map((l) => (prevDone.has(l.layerId) ? "done" : "pending"));
  touchPlan(key, {
    fileId,
    pageLayerId,
    pageName,
    layers,
    statuses,
    outDir: prev?.outDir,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * 查找 layerId 所属的活动计划。
 * 一个图层 id 理论上只属于一个页计划；遍历取第一个命中（Map 规模 ≤64，代价可忽略）。
 */
function findPlanByLayerId(fileId: string, layerId: string): PageRestorePlan | undefined {
  for (const plan of plans.values()) {
    if (plan.fileId !== fileId) continue;
    if (plan.layers.some((l) => l.layerId === layerId)) return plan;
  }
  return undefined;
}

/** getDesignSections(section list 模式) 命中计划图层时标记 in_progress。 */
export function markLayerInProgress(fileId: string, layerId: string): void {
  const plan = findPlanByLayerId(fileId, layerId);
  if (!plan) return;
  const idx = plan.layers.findIndex((l) => l.layerId === layerId);
  if (idx >= 0 && plan.statuses[idx] !== "done") plan.statuses[idx] = "in_progress";
  touchPlan(planKey(plan.fileId, plan.pageLayerId), plan);
}

/** applyDesign 成功：记录 outDir、标记 done。返回 null 表示不属于任何计划。 */
export function completeLayer(
  fileId: string,
  layerId: string,
  outDir?: string,
): PageRestorePlan | null {
  const plan = findPlanByLayerId(fileId, layerId);
  if (!plan) return null;
  const idx = plan.layers.findIndex((l) => l.layerId === layerId);
  if (idx >= 0) plan.statuses[idx] = "done";
  if (outDir) plan.outDir = outDir;
  touchPlan(planKey(plan.fileId, plan.pageLayerId), plan);
  return plan;
}

/** 确定性失败（如 10017 超大图层）：标记 failed，跳过该层继续。 */
export function failLayer(fileId: string, layerId: string): PageRestorePlan | null {
  const plan = findPlanByLayerId(fileId, layerId);
  if (!plan) return null;
  const idx = plan.layers.findIndex((l) => l.layerId === layerId);
  if (idx >= 0 && plan.statuses[idx] !== "done") plan.statuses[idx] = "failed";
  touchPlan(planKey(plan.fileId, plan.pageLayerId), plan);
  return plan;
}

/** 文件名建议：图层名清洗为安全文件名，冲突时追加 layerId 尾段。 */
export function suggestFileName(name: string, layerId: string): string {
  const cleaned = (name || "")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const tail = layerId.split(":").pop() || layerId;
  return cleaned ? `${cleaned}-${tail}.html` : `layer-${tail}.html`;
}

/**
 * 计划内下一个待处理图层：in_progress 优先（进行中被中断的），其次 pending。
 * failed 不参与——10017 等确定性失败已按「跳过」处理，重试必然同样失败；
 * 全部层为 done/failed 时返回 null（计划收尾）。
 */
function nextLayer(plan: PageRestorePlan): { index: number; layer: PlannedLayer } | null {
  const idx = plan.statuses.indexOf("in_progress");
  if (idx >= 0) return { index: idx, layer: plan.layers[idx] };
  const pending = plan.statuses.indexOf("pending");
  if (pending >= 0) return { index: pending, layer: plan.layers[pending] };
  return null;
}

/**
 * 构建注入到工具响应里的 pageRestore 载荷（轻量投影，不含内部时间戳）。
 * 返回 null 表示该 layerId 不属于任何活动计划（单图层正常还原，不注入）。
 */
export function buildPageRestorePayload(
  fileId: string,
  layerId: string,
): {
  position: string;
  nextLayerId?: string;
  nextFileName?: string;
  outDir?: string;
  progress: string;
  total: number;
  done: number;
  failed: number;
} | null {
  const plan = findPlanByLayerId(fileId, layerId);
  if (!plan) return null;
  const idx = plan.layers.findIndex((l) => l.layerId === layerId);
  if (idx < 0) return null;
  const done = plan.statuses.filter((s) => s === "done").length;
  const failed = plan.statuses.filter((s) => s === "failed").length;
  const next = nextLayer(plan);
  const payload: any = {
    position: `[${idx + 1}/${plan.layers.length}] of page "${plan.pageName || plan.pageLayerId}"`,
    progress: `${done}/${plan.layers.length} layers fully restored`,
    total: plan.layers.length,
    done,
    failed,
  };
  if (next) {
    payload.nextLayerId = next.layer.layerId;
    payload.nextFileName = suggestFileName(next.layer.name, next.layer.layerId);
  }
  if (plan.outDir) payload.outDir = plan.outDir;
  return payload;
}

/** applyDesign 成功后的下一步指令（含下一个图层信息；全部完成时给汇总收尾）。 */
export function buildNextLayerInstruction(
  plan: PageRestorePlan,
): {
  instruction: string;
  allDone: boolean;
  next?: { layerId: string; name: string; fileName: string };
} {
  const key = planKey(plan.fileId, plan.pageLayerId);
  const done = plan.statuses.filter((s) => s === "done").length;
  const failed = plan.statuses.filter((s) => s === "failed").length;
  const next = nextLayer(plan);
  if (!next) {
    // 全部处理完（done+failed 覆盖全部）：清理计划并返回汇总。
    plans.delete(key);
    return {
      instruction:
        `PAGE RESTORE COMPLETE: ${done}/${plan.layers.length} layers restored to separate files` +
        (failed > 0 ? `, ${failed} layer(s) skipped due to errors (10017 oversized etc.)` : "") +
        `. Verify each file opens standalone, then report the file list to the user.`,
      allDone: true,
    };
  }
  const dirHint = plan.outDir ? ` (reuse outDir "${plan.outDir}")` : "";
  const fileName = suggestFileName(next.layer.name, next.layer.layerId);
  return {
    instruction:
      `CONTINUE PAGE RESTORE — next layer [${next.index + 1}/${plan.layers.length}]: ` +
      `"${next.layer.name}" (layerId=${next.layer.layerId}). ` +
      `Run the single-layer workflow on it: getDesignSections(fileId=${plan.fileId}, layerId=${next.layer.layerId}) ` +
      `→ fetch ALL its sections → generate HTML → applyDesign${dirHint} writing file "${fileName}". ` +
      `Do NOT merge it into an existing file. Do NOT declare the whole page finished — ${plan.layers.length - done} layer(s) still pending.`,
    allDone: false,
    next: { layerId: next.layer.layerId, name: next.layer.name, fileName },
  };
}

/** 测试/内部用：清空全部计划（不导出 plans 本体，保持封装）。 */
export function resetForTest(): void {
  plans.clear();
}

// TTL 兜底定时清理：周期扫描过期计划（不阻塞进程退出）。
setInterval(() => {
  const now = Date.now();
  for (const [key, plan] of plans) {
    if (now - plan.updatedAt > PLAN_TTL_MS) plans.delete(key);
  }
}, Math.min(PLAN_TTL_MS, 60000)).unref();
