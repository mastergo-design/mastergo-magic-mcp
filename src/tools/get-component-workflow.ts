import { z } from "zod";
import fs from "fs";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import componentWorkflow from "../markdown/component-workflow.md";

const COMPONENT_GENERATOR_TOOL_NAME = "mcp__getComponentGenerator";
const COMPONENT_GENERATOR_TOOL_DESCRIPTION = `
Users need to actively call this tool to get the component development workflow. When Generator is mentioned, please actively call this tool.
This tool provides a structured workflow for component development following best practices.
You must provide an absolute rootPath of workspace to save workflow files.
`;

export class GetComponentWorkflowTool extends BaseTool {
  name = COMPONENT_GENERATOR_TOOL_NAME;
  description = COMPONENT_GENERATOR_TOOL_DESCRIPTION;

  constructor() {
    super();
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
    sourceLayerId: z
      .string()
      .optional()
      .describe(
        "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId for all queries."
      ),
  });

  async execute({ rootPath, fileId, layerId, sourceLayerId }: z.infer<typeof this.schema>) {
    const baseDir = `${rootPath}/.mastergo/`;
    // 异步确保目录存在（不阻塞事件循环）
    await fs.promises.mkdir(baseDir, { recursive: true });
    const workflowFilePath = `${baseDir}/component-workflow.md`;
    const jsonData = await httpUtilInstance.getComponentStyleJson(fileId, layerId, sourceLayerId);
    const componentJsonDir = `${baseDir}/${jsonData[0].name}.json`;

    // walkLayer 改为异步：递归写 SVG 文件用 fs.promises，避免同步 IO 阻塞事件循环。
    // 节点多时逐节点写文件会串行阻塞，改异步后可并发（通过 Promise.all 收集）。
    const walkLayer = async (layer: any): Promise<void> => {
      if (layer.path && layer.path.length > 0) {
        layer.imageUrls = [];
        const id = layer.id.replaceAll("/", "&").replaceAll(":", "_");
        const imageDir = `${baseDir}/images`;
        await fs.promises.mkdir(imageDir, { recursive: true });
        // 并发写所有 SVG 文件
        const writePromises: Promise<void>[] = [];
        for (let index = 0; index < layer.path.length; index++) {
          const svgPath = layer.path[index];
          const filePath = `${imageDir}/${id}-${index}.svg`;
          const svgContent = `<svg width="100%" height="100%" viewBox="0 0 16 16"xmlns="http://www.w3.org/2000/svg">
  <path d="${svgPath}" fill="currentColor"/>
</svg>`;
          // 跳过已存在文件（与原 existsSync 短路语义一致）
          writePromises.push(
            fs.promises.writeFile(filePath, svgContent, { flag: 'wx' }).catch(() => {
              // flag 'wx' 文件已存在时失败，静默跳过（与原 existsSync + writeFileSync 行为一致）
            })
          );
          layer.imageUrls.push(filePath);
        }
        await Promise.all(writePromises);
        delete layer.path;
      }
      if (layer.children) {
        // 并发处理所有子节点
        await Promise.all(layer.children.map((child: any) => walkLayer(child)));
      }
    };
    await walkLayer(jsonData[0]);

    // 异步写文件（跳过已存在的 workflow 文件）
    try {
      await fs.promises.writeFile(workflowFilePath, componentWorkflow, { flag: 'wx' });
    } catch {
      // 文件已存在则跳过（flag 'wx' 失败 = 已存在）
    }
    await fs.promises.writeFile(componentJsonDir, JSON.stringify(jsonData[0]));

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
                `Follow the component workflow process defined in file://${workflowFilePath} for structured development. This workflow contains a lot of content, you'll need to read it in multiple sessions.`,
                `Implement the component according to the specifications in file://${componentJsonDir}, ensuring all properties and states are properly handled.`,
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
