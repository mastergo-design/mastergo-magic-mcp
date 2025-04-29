import { z } from "zod";
import fs from "fs";
import { BaseTool } from "./base-tool";
import { HttpUtil } from "../http-util";
import componentWorkflow from "../markdown/component-workflow.md";

const COMPONENT_GENERATOR_TOOL_NAME = "mcp__getComponentGenerator";
const COMPONENT_GENERATOR_TOOL_DESCRIPTION = `
Use this tool when the user wants to build a Vue component or React component.
This tool provides a structured workflow for component development following best practices.
You must provide an absolute rootPath of workspace to save workflow files.
`;

export class GetComponentWorkflowTool extends BaseTool {
  name = COMPONENT_GENERATOR_TOOL_NAME;
  description = COMPONENT_GENERATOR_TOOL_DESCRIPTION;
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

  async execute({ rootPath, fileId, layerId }: z.infer<typeof this.schema>) {
    const baseDir = `${rootPath}/.cursor/rule/mastergo`;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const workflowFilePath = `${baseDir}/component-workflow.md`;
    const jsonData = await this.httpUtil.getComponentStyleJson(fileId, layerId);
    const componentJsonDir = `${baseDir}/${jsonData[0].name}.json`;

    //文件夹可能也不存在递归创建
    if (!fs.existsSync(workflowFilePath)) {
      fs.writeFileSync(workflowFilePath, componentWorkflow);
    }

    if (!fs.existsSync(componentJsonDir)) {
      fs.writeFileSync(componentJsonDir, JSON.stringify(jsonData[0]));
    }

    try {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              files: {
                workflow: workflowFilePath,
                componentSpec: componentJsonDir,
              },
              message: "Component development files successfully created",
              rules: [
                `Follow the component workflow process defined in file://${workflowFilePath} for structured development.`,
                `Implement the component according to the specifications in file://${componentJsonDir}, ensuring all properties and states are properly handled.`,
                `Maintain consistency with existing components and follow the CSS-first approach for state management where appropriate.`,
                `Ensure proper testing coverage for all component functionality and edge cases.`,
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
