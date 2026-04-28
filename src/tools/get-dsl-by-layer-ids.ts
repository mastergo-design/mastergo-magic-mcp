import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const DSL_BY_IDS_TOOL_NAME = "mcp__getDslByLayerIds";
const DSL_BY_IDS_TOOL_DESCRIPTION = `
Use this tool to get full DSL details for ONE section at a time from a MasterGo design.

IMPORTANT: Pass only ONE section layer ID per call. Do NOT batch multiple section IDs into one call.
Fetching sections one at a time ensures no data is lost due to response size limits.

After calling mcp__getLayerTree, iterate through each section:
- Call this tool with targetLayerIds=["section_1_id"] → process the response
- Call this tool with targetLayerIds=["section_2_id"] → process the response
- ... and so on for each section

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

export class GetDslByLayerIdsTool extends BaseTool {
  name = DSL_BY_IDS_TOOL_NAME;
  description = DSL_BY_IDS_TOOL_DESCRIPTION;

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
        "Root layer ID of the design (used to fetch the design data). Required if shortLink is not provided."
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
    targetLayerIds: z
      .array(z.string())
      .describe(
        "Array of layer IDs to retrieve full DSL for. Get these IDs from mcp__getLayerTree output."
      ),
    layerLimit: z
      .number()
      .optional()
      .default(50)
      .describe(
        "Maximum child layers per target subtree. Nodes exceeding this get needParse=true. Default: 50."
      ),
    svgDataLimit: z
      .number()
      .optional()
      .describe("Maximum SVG path data length. Default: no limit."),
  });

  async execute(params: z.infer<typeof this.schema>) {
    try {
      const { fileId, layerId, shortLink, targetLayerIds, layerLimit, svgDataLimit } = params;

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

      if (!targetLayerIds || targetLayerIds.length === 0) {
        throw new Error("Please provide at least one targetLayerId");
      }

      const result = await httpUtilInstance.getDslByLayerIds(
        finalFileId,
        finalLayerId,
        targetLayerIds,
        { layerLimit, svgDataLimit }
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
