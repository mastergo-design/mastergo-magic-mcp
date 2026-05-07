import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const DESIGN_PATHS_TOOL_NAME = "mcp__getDesignPaths";
const DESIGN_PATHS_TOOL_DESCRIPTION = `
(DEPRECATED — pathData is now included directly in mcp__getDesignSections responses.)
Retrieve cached SVG path data for the design.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

export class GetDesignPathsTool extends BaseTool {
  name = DESIGN_PATHS_TOOL_NAME;
  description = DESIGN_PATHS_TOOL_DESCRIPTION;

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
  });

  async execute({ fileId, layerId, shortLink }: z.infer<typeof this.schema>) {
    try {
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

      const result = await httpUtilInstance.getDesignPaths(
        finalFileId,
        finalLayerId
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
