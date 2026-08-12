import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

const PAGE_LAYERS_TOOL_NAME = "mcp__getPageLayers";
const PAGE_LAYERS_TOOL_DESCRIPTION = `
List ALL layers under a given page (or any container layer) of a MasterGo design file.
This is the ENUMERATION step of the multi-layer restoration workflow — it only lists
layer_ids; it does NOT restore designs.

**Workflow (enumerate → build URLs → restore one by one):**
  1. Call this tool with the page_id / parent layerId to get the full layer list.
  2. Pick the top-level restorable layers from the result (FRAME/COMPONENT/INSTANCE at
     depth 0/1). For each, build a URL: https://mastergo.com/file/{fileId}?layer_id={id}
     (URL-encode the id, e.g. 802:02364 → 802%3A02364).
  3. Restore them SEQUENTIALLY — take one layer_id, run the full single-layer restoration
     (mcp__getDesignSections → fetch all sections → mcp__applyDesign), write its HTML to its
     OWN separate .html file (a complete standalone document with <!DOCTYPE html>/<head>/<body>),
     THEN move to the next. Do NOT batch-restore. Do NOT merge multiple layers into one HTML file —
     ONE layer = ONE standalone .html file.

You can provide either:
1. fileId and layerId directly (layerId = the page's layerId, i.e. page_id), or
2. a short link (like https://{domain}/goto/LhGgBAK)

The returned layer list is lightweight: each entry has id, name, type, depth, parentId,
childrenCount, width, height. It does NOT contain DSL/styles/SVG paths — use the section
or DSL tools to restore each layer.

NOTE: This tool cannot enumerate a document's PAGE list from a fileId alone — you must
already know a page_id / layerId to pass in. The synthetic page_id=M returns empty
(page data not available via this API); use a real layer_id URL in that case.
`;

export class GetPageLayersTool extends BaseTool {
  name = PAGE_LAYERS_TOOL_NAME;
  description = PAGE_LAYERS_TOOL_DESCRIPTION;

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
        "Page layer ID to enumerate. This is the page_id from the MasterGo URL (e.g. \"40:015\"). Required if shortLink is not provided."
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
  }).passthrough();

  async execute({ fileId, layerId, shortLink, sourceLayerId, format, ...rest }: z.infer<typeof this.schema>) {
    try {
      // 阻断未知参数（与 getDesignSections 一致）：排除 _ 前缀元字段。
      const unknownKeys = Object.keys(rest as Record<string, unknown>).filter((k) => !k.startsWith("_"));
      if (unknownKeys.length > 0) {
        const errorText = `Unknown parameter(s): ${unknownKeys.join(", ")}. This tool only accepts: fileId, layerId, sourceLayerId, shortLink, format. Remove the unknown parameter(s) and retry.`;
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: errorText }),
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

      const result = await httpUtilInstance.getPageLayers(
        finalFileId,
        effectiveLayerId
      );

      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(result, format),
          },
        ],
      };
    } catch (error: any) {
      // 统一错误结构：response.data 可能是对象/字符串/undefined，归一成 { error, message } 供 LLM 稳定解析。
      // 与 getDesignSections 的错误处理风格一致（避免 JSON.stringify 一个裸字符串得到带引号的 "..."）。
      const errData = error?.response?.data;
      const errorMessage =
        (typeof errData === 'string' ? errData : errData?.message) ||
        error?.message ||
        'Unknown error';
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: 'getPageLayers failed', message: errorMessage }),
          },
        ],
      };
    }
  }
}
