import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import { formatField, formatOutput } from "../utils/format";

const EXTRACT_SVG_TOOL_NAME = "mcp__extractSvg";
const EXTRACT_SVG_TOOL_DESCRIPTION = `
Extract SVG data from MasterGo design files. This tool retrieves the DSL from a design layer, finds all PATH nodes (typically inside INSTANCE/icon components), resolves their color references, and generates SVG markup strings.
You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)

Pagination: When there are many icons, use the first call without "page" to get totalCount. Then call again with page=0, page=1, etc. (page starts at 0, pageSize defaults to 20, max 100). If hasMore is false, you've fetched all pages.
`;

export class ExtractSvgTool extends BaseTool {
  name = EXTRACT_SVG_TOOL_NAME;
  description = EXTRACT_SVG_TOOL_DESCRIPTION;

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
        "Layer ID of the specific component or element to retrieve (format: ?layer_id=<layerId>). Required if shortLink is not provided."
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
    backgroundColor: z
      .string()
      .optional()
      .describe(
        "Solid background color for the SVG (e.g. '#000000', 'black'). Useful for previewing white/light icons."
      ),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Page number for pagination (starts at 0). Omit to get all SVGs at once. When provided, the response includes totalCount/hasMore/page/pageSize for you to iterate through all pages."
      ),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Number of SVGs per page (default 20, max 100). Only used when page is provided."
      ),
    format: formatField(),
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, sourceLayerId, shortLink, backgroundColor, page, pageSize, format } = params;

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

      const result = await httpUtilInstance.extractSvg(
        finalFileId,
        effectiveLayerId,
        backgroundColor,
        page,
        pageSize
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
