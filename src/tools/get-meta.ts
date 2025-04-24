import { z } from "zod";
import { BaseTool } from "./base-tool";
import { HttpUtil } from "../http-util";
import rules from "../markdown/meta.md";

const META_TOOL_NAME = "mcp__getMeta";
const META_TOOL_DESCRIPTION = `
Use this tool when the user intends to build a complete website or needs to obtain high-level site
configuration information. You must provide a fileld and layerld to identify the specific design element.
This tool returns the rules and results of the site and page. The rules is a markdown file, you must
follow the rules and use the results to analyze the site and page.
`;

export class GetMetaTool extends BaseTool {
  name = META_TOOL_NAME;
  description = META_TOOL_DESCRIPTION;
  private httpUtil: HttpUtil;

  constructor(httpUtil: HttpUtil) {
    super();
    this.httpUtil = httpUtil;
  }

  schema = z.object({
    fileId: z
      .string()
      .describe(
        "MasterGo design file ID (format: file/<fileId> in MasterGo URL)"
      ),
    layerId: z
      .string()
      .describe(
        "Layer ID of the specific component or element to retrieve (format: ?layer_id=<layerId> / file=<fileId> in MasterGo URL)"
      ),
  });

  async execute({ fileId, layerId }: z.infer<typeof this.schema>) {
    try {
      const result = await this.httpUtil.getMeta(fileId, layerId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
                result,
                rules,
            }),
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
