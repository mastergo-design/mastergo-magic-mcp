import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const DESIGN_TEXTS_TOOL_NAME = "mcp__getDesignTexts";
const DESIGN_TEXTS_TOOL_DESCRIPTION = `
After fetching ALL sections via mcp__getDesignSections, call this tool to retrieve exact text content for large text nodes.
In the section DSL, TEXT nodes with long content (>50 chars) have their "text" field replaced with a key like "T{sectionIndex}|{nodeId}".
This tool returns the original text mapped by those keys. You MUST use the exact text from this response — never invent, paraphrase, or translate text.

You can provide either:
1. fileId and layerId directly, or
2. a short link (like https://{domain}/goto/LhGgBAK)
`;

export class GetDesignTextsTool extends BaseTool {
  name = DESIGN_TEXTS_TOOL_NAME;
  description = DESIGN_TEXTS_TOOL_DESCRIPTION;

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

      const result = await httpUtilInstance.getDesignTexts(
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
