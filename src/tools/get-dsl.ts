import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

// 进程级跟踪：记录已通过 getDesignSections 拉取过 section list 的 fileId+layerId。
// 如果 LLM 在 section 工作流进行中调 getDsl，会返回 195KB+ 的全量数据撑爆上下文窗口，
// 导致后续 section DSL 无法继续拉取（实测：15/48 section 后被迫停止）。
// 拦截策略：如果同一个设计已经调过 section list，拒绝 getDsl 调用。
const sectionWorkflowActive = new Set<string>();

// 进程级跟踪：记录每个设计已拉取的 sectionIndex 集合 + 总数。
// 用于在每个 section DSL 响应里动态注入 fetchProgress，持续提醒 LLM 还剩多少未拉取。
const fetchedSections: Map<string, Set<number>> = new Map();
const totalSectionsMap: Map<string, number> = new Map();

// 三容器仅在 applyDesign 成功时经 clearSectionWorkflow 清理；若 LLM 不调 applyDesign
// （失败/放弃/走旧路径），key 只写不删会单调增长。故加硬上限 + TTL 兜底（stdio 长驻进程防泄漏）。
// TTL 取 30min：section 工作流（逐个拉 48 section + 生成代码）可能较长，TTL 过短会误清进行中工作流。
const SECTION_TRACKER_MAX_ENTRIES = parseInt(process.env.SECTION_TRACKER_MAX_ENTRIES || "1000", 10);
const SECTION_TRACKER_TTL_MS = parseInt(process.env.SECTION_TRACKER_TTL_MS || "1800000", 10);
const trackerTimestamps: Map<string, number> = new Map();

/** 刷新 tracker key 活跃时间戳，LRU 淘汰超容 key（连带清三容器）。 */
function touchTrackerKey(key: string): void {
  if (trackerTimestamps.has(key)) {
    trackerTimestamps.delete(key);
  } else if (trackerTimestamps.size >= SECTION_TRACKER_MAX_ENTRIES) {
    const oldest = trackerTimestamps.keys().next().value;
    if (oldest !== undefined) {
      sectionWorkflowActive.delete(oldest);
      fetchedSections.delete(oldest);
      totalSectionsMap.delete(oldest);
      trackerTimestamps.delete(oldest);
    }
  }
  trackerTimestamps.set(key, Date.now());
}

// TTL 兜底定时清理：周期扫描过期 key（不阻塞进程退出）。
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of trackerTimestamps) {
    if (now - ts > SECTION_TRACKER_TTL_MS) {
      sectionWorkflowActive.delete(key);
      fetchedSections.delete(key);
      totalSectionsMap.delete(key);
      trackerTimestamps.delete(key);
    }
  }
}, SECTION_TRACKER_TTL_MS).unref();

/** 标记某个设计已进入 section 工作流（由 get-design-sections 调用）。 */
export function markSectionWorkflowActive(fileId: string, layerId: string) {
  const key = `${fileId}:${layerId}`;
  sectionWorkflowActive.add(key);
  touchTrackerKey(key);
}

/** 记录 section list 的总数（由 get-design-sections 在 list 模式调用）。 */
export function setTotalSections(fileId: string, layerId: string, total: number) {
  const key = `${fileId}:${layerId}`;
  totalSectionsMap.set(key, total);
  if (!fetchedSections.has(key)) fetchedSections.set(key, new Set());
  touchTrackerKey(key);
}

/** 记录已拉取的 sectionIndex，返回当前进度信息。 */
export function trackSectionFetched(fileId: string, layerId: string, sectionIndex: number): { fetched: number; total: number; remaining: number; missingIndices: number[] } | null {
  const key = `${fileId}:${layerId}`;
  const total = totalSectionsMap.get(key);
  if (total === undefined) return null;
  const fetched = fetchedSections.get(key) ?? new Set<number>();
  fetched.add(sectionIndex);
  fetchedSections.set(key, fetched);
  touchTrackerKey(key);
  const missingIndices: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!fetched.has(i)) missingIndices.push(i);
  }
  return { fetched: fetched.size, total, remaining: missingIndices.length, missingIndices };
}

/**
 * 清理指定设计的 section 工作流跟踪数据。
 * 在 applyDesign 成功完成后调用 —— 工作流结束，跟踪数据已无用，释放内存避免泄漏。
 * （stdio 长驻进程：不清理则每个设计稿的 key 永久残留，sectionWorkflowActive /
 *  fetchedSections / totalSectionsMap 三个全局容器单调增长。）
 */
export function clearSectionWorkflow(fileId: string, layerId: string): void {
  const key = `${fileId}:${layerId}`;
  sectionWorkflowActive.delete(key);
  fetchedSections.delete(key);
  totalSectionsMap.delete(key);
  trackerTimestamps.delete(key);
}

const DSL_TOOL_NAME = "mcp__getDsl";
const DSL_TOOL_DESCRIPTION = `
[FALLBACK] Use only when mcp__getDesignSections is unavailable or returns an error.
This returns the FULL DSL in one response — may be large and exceed context limits for complex designs.
Prefer mcp__getDesignSections as the primary tool for all designs.
You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
This tool returns the raw DSL data that you can then parse and analyze. Use the optional 'format' parameter (json/yaml/tree, defaults to json) to control the serialization.
This tool also returns the rules you must follow when generating code.
The DSL data can also be used to transform and generate code for different frameworks.
`;

export class GetDslTool extends BaseTool {
  name = DSL_TOOL_NAME;
  description = DSL_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    fileId: z
      .string()
      .optional()
      .describe(
        "MasterGo design file ID (format: file/<fileId> in MasterGo URL). Required if shortLink is not provided."
      ),
    layerId: z
      .string()
      .optional()
      .describe(
        "Layer ID of the specific component or element to retrieve (format: ?layer_id=<layerId> / file=<fileId> in MasterGo URL). Required if shortLink is not provided."
      ),
    sourceLayerId: z
      .string()
      .optional()
      .describe(
        "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId for all queries."
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
    format: formatField(),
  });

  async execute({ fileId, layerId, sourceLayerId, shortLink, format }: z.infer<typeof this.schema>) {
    try {
      if (!shortLink && (!fileId || (!layerId && !sourceLayerId))) {
        throw new Error(
          "Either provide fileId with layerId (or sourceLayerId), or provide a MasterGo URL"
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

      // 拦截：如果 section 工作流已激活（LLM 已调过 getDesignSections），
      // 拒绝 getDsl 调用——它会返回 195KB+ 全量数据撑爆上下文窗口，
      // 导致后续 section DSL 无法拉取。
      const workflowKey = `${finalFileId}:${effectiveLayerId}`;
      if (sectionWorkflowActive.has(workflowKey)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "getDsl BLOCKED: You have already started the section workflow (mcp__getDesignSections) for this design. Do NOT call getDsl during or after the section workflow — it returns 195KB+ of full DSL data that will exhaust your context window and prevent you from fetching remaining sections. Continue fetching section DSL via mcp__getDesignSections with sectionIndex=N. If you need data you think only getDsl provides, it is already available in the section DSL responses (rowTexts, dsl.nodes).",
              }),
            },
          ],
        };
      }

      const dsl = await httpUtilInstance.getDsl(finalFileId, effectiveLayerId, {
        sourceLayerId: finalSourceLayerId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(dsl, format),
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
