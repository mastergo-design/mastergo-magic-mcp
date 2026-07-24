import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

const PAGE_LAYERS_TOOL_NAME = "mcp__getPageLayers";
const PAGE_LAYERS_TOOL_DESCRIPTION = `
List ALL layers under a given page (or any container layer) of a MasterGo design file.

Use this when you need to enumerate the layer_ids of a page — typically BEFORE restoring
the full design. The workflow is:
  1. Call this tool with the page's layerId (it is the page_id from the MasterGo URL,
     e.g. "40:015"). It returns every layer inside that page as a flat list.
  2. For each returned layer_id, call mcp__getDesignSections or mcp__getDsl with that
     layer_id to restore its design.

You can provide either:
1. fileId and layerId directly (layerId = the page's layerId, i.e. page_id), or
2. a short link (like https://{domain}/goto/LhGgBAK)

The returned layer list is lightweight: each entry has id, name, type, depth, parentId,
childrenCount, width, height. It does NOT contain DSL/styles/SVG paths — use the section
or DSL tools to restore each layer.

NOTE: This tool cannot enumerate a document's PAGE list from a fileId alone — you must
already know a page_id / layerId to pass in.
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
