import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const DESIGN_SVGS_TOOL_NAME = "mcp__getDesignSvgs";
const DESIGN_SVGS_TOOL_DESCRIPTION = `
After fetching ALL sections via mcp__getDesignSections, call this tool to retrieve all cached SVG HTML strings.
Each PATH node in the DSL has an id. Look up that id in the returned svgs map to get the complete SVG string.
Insert the svgHtml string directly into HTML where icons should appear.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

export class GetDesignSvgsTool extends BaseTool {
  name = DESIGN_SVGS_TOOL_NAME;
  description = DESIGN_SVGS_TOOL_DESCRIPTION;

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
  });

  async execute({
    fileId,
    layerId,
    sourceLayerId,
    shortLink,
  }: z.infer<typeof this.schema>) {
    try {
      if (!shortLink && (!fileId || !layerId)) {
        throw new Error(
          "Either provide both fileId and layerId, or provide a shortLink"
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

      if (!finalFileId || !finalLayerId) {
        throw new Error("Could not determine fileId or layerId");
      }

      const effectiveLayerId = finalSourceLayerId || finalLayerId;

      const result = await httpUtilInstance.getDesignSvgs(
        finalFileId,
        effectiveLayerId
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
}
