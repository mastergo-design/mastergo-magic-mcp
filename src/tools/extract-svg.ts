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
Returns { count, svgs: [{ name, id, svg }] } — one entry per icon/instance found in the design.
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
    format: formatField(),
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, sourceLayerId, shortLink, backgroundColor, format } = params;

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
        backgroundColor
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
