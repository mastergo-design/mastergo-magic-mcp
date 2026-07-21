import { z } from "zod";
import fs from "fs";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import componentWorkflow from "../markdown/component-workflow.md";

/**
 * 轻量并发限制器：限制同时进行的 Promise 数量。
 *
 * 用于 walkLayer 递归写 SVG：超大设计稿（数千~数万节点）全并发会瞬时
 * 创建大量 Promise + 占满 libuv 线程池的 FS 任务队列，慢 IO（网络挂载、
 * overlayfs）下还可能触发 EMFILE（FD 上限）。用并发上限保护，同时仍
 * 保留异步并发的性能优势。
 *
 * 不引入 p-limit 等外部依赖（保持依赖最小化），内部用计数器 + 等待队列实现。
 */
function createConcurrencyLimiter(maxConcurrency: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  const release = (): void => {
    active--;
    const next = waiters.shift();
    if (next) {
      // 复用 active 槽位，唤醒下一个等待者
      active++;
      next();
    }
  };
  return async function <T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active++;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// 并发上限：writeFile 阶段（IO 密集）和 children 递归阶段分别限制。
// 数值参考：libuv 默认线程池 4，Node 默认 FD 上限 1024。32 足以保持高吞吐
// 同时避免瞬时打满 FD / 线程池队列。
const WRITE_FILE_CONCURRENCY = 32;
const CHILDREN_RECURSION_CONCURRENCY = 8;

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
    // 用并发限制器（限流器在每次 execute 重建，互不污染）：限制 writeFile 并发避免打满 FD，
    // 限制 children 递归并发避免超大设计稿瞬时创建过多 Promise。
    const limitWriteFile = createConcurrencyLimiter(WRITE_FILE_CONCURRENCY);
    const limitRecurse = createConcurrencyLimiter(CHILDREN_RECURSION_CONCURRENCY);

    const walkLayer = async (layer: any): Promise<void> => {
      if (layer.path && layer.path.length > 0) {
        layer.imageUrls = [];
        const id = layer.id.replaceAll("/", "&").replaceAll(":", "_");
        const imageDir = `${baseDir}/images`;
        await fs.promises.mkdir(imageDir, { recursive: true });
        // 并发写所有 SVG 文件（受 WRITE_FILE_CONCURRENCY 限流，避免打满 FD）
        const writePromises: Promise<void>[] = [];
        for (let index = 0; index < layer.path.length; index++) {
          const svgPath = layer.path[index];
          const filePath = `${imageDir}/${id}-${index}.svg`;
          const svgContent = `<svg width="100%" height="100%" viewBox="0 0 16 16"xmlns="http://www.w3.org/2000/svg">
  <path d="${svgPath}" fill="currentColor"/>
</svg>`;
          // 跳过已存在文件（与原 existsSync 短路语义一致）
          writePromises.push(
            limitWriteFile(() =>
              fs.promises.writeFile(filePath, svgContent, { flag: 'wx' }).catch(() => {
                // flag 'wx' 文件已存在时失败，静默跳过（与原 existsSync + writeFileSync 行为一致）
              })
            )
          );
          layer.imageUrls.push(filePath);
        }
        await Promise.all(writePromises);
        delete layer.path;
      }
      if (layer.children) {
        // 并发处理所有子节点（受 CHILDREN_RECURSION_CONCURRENCY 限流）
        await Promise.all(
          layer.children.map((child: any) => limitRecurse(() => walkLayer(child)))
        );
      }
    };
    await walkLayer(jsonData[0]);

    // 异步写文件（跳过已存在的 workflow 文件）
    try {
      // workflow 是静态模板（componentWorkflow markdown），幂等跳过已存在即可。
      await fs.promises.writeFile(workflowFilePath, componentWorkflow, { flag: 'wx' });
    } catch {
      // 文件已存在则跳过（flag 'wx' 失败 = 已存在）
    }
    // 注意：component json 不用 'wx' —— 它由本次 API 返回的 jsonData 派生（含 imageUrls），
    // 每次执行 path 可能变化（设计稿更新），故每次都覆盖为最新内容，与 workflow 的幂等语义不同。
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
