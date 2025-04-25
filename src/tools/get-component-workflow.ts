import { z } from "zod";
import fs from "fs";
import { BaseTool } from "./base-tool";
import { HttpUtil } from "../http-util";
import componentWorkflow from "../markdown/component-workflow.md";
import componentUiDesign from "../markdown/component-ui-design.md";

const META_TOOL_NAME = "mcp__getComponentWorkflow";
const META_TOOL_DESCRIPTION = `
Use this tool when the user wants to build a Vue component or React component.
You must provide a rootPath of workspace to save workflow files.
`;

export class GetComponentWorkflowTool extends BaseTool {
  name = META_TOOL_NAME;
  description = META_TOOL_DESCRIPTION;
  private httpUtil: HttpUtil;

  constructor(httpUtil: HttpUtil) {
    super();
    this.httpUtil = httpUtil;
  }

  schema = z.object({
    rootPath: z
      .string()
      .describe(
        "The root path of the project, if the user does not provide, you can use the current directory as the root path"
      ),
  });

  async execute({ rootPath }: z.infer<typeof this.schema>) {
    const architectureDir = `${rootPath}/architecture/component-workflow.md`;
    const designPrincipleDir = `${rootPath}/architecture/component-ui-design.md`;

    if (!fs.existsSync(architectureDir)) {
      fs.writeFileSync(architectureDir, componentWorkflow);
    }

    if (!fs.existsSync(designPrincipleDir)) {
      fs.writeFileSync(designPrincipleDir, componentUiDesign);
    }

    try {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              "component-workflow": `Workflow file saved at path: ${architectureDir}`,
              "component-ui-design": `UI design file saved at path: ${designPrincipleDir}`,
              rules: [
                `You must follow the ${architectureDir} to build the component.`,
                `You must follow the ${designPrincipleDir} to build the component.`,
              ],
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
