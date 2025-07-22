import { z } from "zod";
import { BaseTool } from "./base-tool";
import { HttpUtil } from "../http-util";

const DSL_TOOL_NAME = "mcp__getDsl";
const DSL_TOOL_DESCRIPTION = `
"Use this tool to retrieve the DSL (Domain Specific Language) data from MasterGo design files and the rules you must follow when generating code.
This tool is useful when you need to analyze the structure of a design, understand component hierarchy, or extract design properties.
You can provide either:
1. fileId and layerId directly, or
2. a MasterGo short link (like https://mastergo.com/goto/LhGgBAK)
This tool returns the raw DSL data in JSON format that you can then parse and analyze.
This tool also returns the rules you must follow when generating code.
The DSL data can also be used to transform and generate code for different frameworks."
`;

export class GetDslTool extends BaseTool {
  name = DSL_TOOL_NAME;
  description = DSL_TOOL_DESCRIPTION;
  private httpUtil: HttpUtil;

  constructor(httpUtil: HttpUtil) {
    super();
    this.httpUtil = httpUtil;
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
        "Layer ID of the specific component or element to retrieve (format: ?layer_id=<layerId> / file=<fileId> in MasterGo URL). Required if shortLink is not provided."
      ),
    shortLink: z
      .string()
      .optional()
      .describe(
        "MasterGo short link (like https://mastergo.com/goto/LhGgBAK)."
      ),
  });

  async execute({ fileId, layerId, shortLink }: z.infer<typeof this.schema>) {
    try {
      if (!shortLink && (!fileId || !layerId)) {
        throw new Error(
          "Either provide both fileId and layerId, or provide a MasterGo URL"
        );
      }

      let finalFileId = fileId;
      let finalLayerId = layerId;

      // If URL is provided, extract fileId and layerId from it
      if (shortLink) {
        const ids = await this.httpUtil.extractIdsFromUrl(shortLink);
        finalFileId = ids.fileId;
        finalLayerId = ids.layerId;
      }

      if (!finalFileId || !finalLayerId) {
        throw new Error("Could not determine fileId or layerId");
      }

      const dsl = await this.httpUtil.getDsl(finalFileId, finalLayerId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(dsl),
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
