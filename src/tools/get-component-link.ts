import { z } from "zod";
import { BaseTool } from "./base-tool";
import { HttpUtil } from "../http-util";

const COMPONENT_LINK_TOOL_NAME = "mcp__getComponentLink";
const COMPONENT_LINK_TOOL_DESCRIPTION = `When the data returned by mcp__getDsl contains a non-empty componentDocumentLinks array, this tool is used to sequentially retrieve URLs from the componentDocumentLinks array and then obtain component documentation data. The returned document data is used for you to generate frontend code based on components.`;

export class GetComponentLinkTool extends BaseTool {
  name = COMPONENT_LINK_TOOL_NAME;
  description = COMPONENT_LINK_TOOL_DESCRIPTION;
  private httpUtil: HttpUtil;

  constructor(httpUtil: HttpUtil) {
    super();
    this.httpUtil = httpUtil;
  }

  schema = z.object({
    url: z
      .string()
      .describe(
        "Component documentation link URL, from the componentDocumentLinks property, please ensure the URL is valid"
      ),
  });

  async execute({ url }: z.infer<typeof this.schema>) {
    try {
      const data = await this.httpUtil.request({
        method: "GET",
        url,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `${data}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Failed to get component documentation",
              message: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
    }
  }
}
