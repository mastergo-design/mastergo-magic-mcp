import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput, formatToolError } from "../utils/format";

const EXPORT_LIST_TOOL_NAME = "mcp__getExportList";
const EXPORT_LIST_TOOL_DESCRIPTION = `
List the Export (切图) settings configured on a MasterGo design, WITHOUT rendering any image.
This is the CHEAP metadata step — it only reads the design's Export configuration.

WHY YOU NEED THIS
Some nodes are marked by the designer as **slices** (切图). Those nodes must be restored as
ONE whole image block — NOT decomposed into their child layers, and NOT hand-drawn. But you
cannot know which nodes those are from the ordinary DSL, because the DSL does not carry Export
settings. This tool tells you exactly which nodes are slices.

WHEN TO USE
- Before restoring a design, to learn whether any node is a slice.
- When the user asks for exported assets / 切图 / @2x PNG of a specific area.
- Before calling \`mcp__downloadExportAssets\` (which needs to know which slices exist).

WHAT YOU GET BACK
- \`exports[]\`: { id, layerId, layerName, layerType, format, sizeRule, sizeValue,
                   targetWidth, targetHeight, exportQuality, isSuffix, isBKVisible, ... }
  - \`id\` is the export setting id — pass this as \`exportIds\` when rendering/downloading.
  - \`layerId\` is the node that carries the slice (different from \`id\`).
  - \`targetWidth\` / \`targetHeight\` are the OUTPUT pixel size the designer configured.
- \`scope\`: "page" or "layer" — tells you what range was resolved.
- \`skipped\`: counts of referenced layers that are missing / removed from this design.
- \`imageRefs\`: image references inside slice subtrees (used by the renderer to carry bitmaps).
- \`total\`: number of slices in scope. \`total: 0\` means no slices — restore everything as layers.
- \`guidance\`: how to treat the found slices when generating code.

SCOPE SEMANTICS (important)
The scope is the subtree of the layerId you pass:
- \`layerId = page_id\` (e.g. "M") → all slices in that page.
- \`layerId = a container node\` → only slices INSIDE that node's subtree.
  A node that is ITSELF a slice is NOT included in its own subtree scope — pass the page id
  if you want to find that node. This is why asking with the slice node's own id can return 0.

SUPPORTED FORMATS
PNG / JPG / WEBP can be rendered server-side. SVG / PDF / AVIF appear in the list but cannot be
rendered by the downstream export endpoint — report that honestly instead of pretending.
`;

export class GetExportListTool extends BaseTool {
  name = EXPORT_LIST_TOOL_NAME;
  description = EXPORT_LIST_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z
    .object({
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
          "Layer id (container / node) OR page id. Scope = that node's subtree; a slice node does NOT include itself — use the page id to find it."
        ),
      sourceLayerId: z
        .string()
        .optional()
        .describe(
          "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId."
        ),
      shortLink: z
        .string()
        .optional()
        .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
      format: formatField(),
    })
    .passthrough();

  async execute({ fileId, layerId, shortLink, sourceLayerId, format, ...rest }: z.infer<typeof this.schema>) {
    try {
      const unknownKeys = Object.keys(rest as Record<string, unknown>).filter((k) => !k.startsWith("_"));
      if (unknownKeys.length > 0) {
        const errorText = `Unknown parameter(s): ${unknownKeys.join(", ")}. This tool only accepts: fileId, layerId, sourceLayerId, shortLink, format. Remove the unknown parameter(s) and retry.`;
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: errorText }) }],
        };
      }

      if (!shortLink && (!fileId || (!layerId && !sourceLayerId))) {
        throw new Error("Either provide fileId with layerId (or sourceLayerId), or provide a shortLink");
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

      const result = await httpUtilInstance.getExportList(finalFileId, effectiveLayerId);

      return {
        content: [
          {
            type: "text" as const,
            text: formatOutput(result, format),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatToolError(error, "getExportList"),
          },
        ],
      };
    }
  }
}
