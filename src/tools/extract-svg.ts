import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const EXTRACT_SVG_TOOL_NAME = "mcp__extractSvg";
const EXTRACT_SVG_TOOL_DESCRIPTION = `
Extract SVG data from MasterGo design files. This tool retrieves the DSL from a design layer, finds all PATH nodes (typically inside INSTANCE/icon components), resolves their color references, and generates SVG markup strings.
You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
Returns an array of SVG strings, one per icon/instance found in the design.
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
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, shortLink, backgroundColor } = params;

      if (!shortLink && (!fileId || !layerId)) {
        throw new Error(
          "Either provide both fileId and layerId, or provide a shortLink"
        );
      }

      let finalFileId = this.normalizeFileId(fileId);
      let finalLayerId = layerId;

      if (shortLink) {
        const ids = await httpUtilInstance.extractIdsFromUrl(shortLink);
        finalFileId = this.normalizeFileId(ids.fileId);
        finalLayerId = ids.layerId;
      }

      if (!finalFileId || !finalLayerId) {
        throw new Error("Could not determine fileId or layerId");
      }

      const result = await httpUtilInstance.extractSvg(
        finalFileId,
        finalLayerId,
        backgroundColor
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
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

  private normalizeFileId(fileId?: string) {
    if (!fileId) return fileId;
    return fileId.replace(/^file\//, "");
  }
}
