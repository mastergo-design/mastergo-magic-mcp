import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const C2D_TOOL_NAME = "mcp__C2d";
const C2D_TOOL_DESCRIPTION = `
使用此工具将代码内容发送到 MasterGo MCP 服务进行 C2D（代码转设计）处理，将用户代码同步到设计稿。

参数说明：
- data：需要转换的代码内容，一般为完整的 HTML 字符串。
- fileId： 不提供 shortLink 时至少需要 fileId。layerId 不是必填，没有就不要传。
- layerId： 可选。图层 ID（只读取 URL 参数 layer_id）。不传或解析不到则仅按 file 维度同步；pageid/page_id 不会被当作 layerId。
- shortLink：可选，短链接形式（例如 https://{domain}/goto/xxxx）。
  注意事项：只允许使用 URL 中的 layer_id 参数作为 layerId，严禁将 pageid/page_id 等任何页面 ID 当作 layerId。
  如果短链接或 URL 中没有解析出 layer_id，则不传 layerId。

工具把 data 原样传给后端，并附带 fileId 与可选的 layerId。
`;

export class GetC2dTool extends BaseTool {
  name = C2D_TOOL_NAME;
  description = C2D_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    data: z
      .string()
      .min(1, "data 不能为空")
      .describe("需要进行 C2D（代码转设计）的代码内容，通常是一整份 HTML 字符串"),
    fileId: z
      .string()
      .optional()
      .describe(
        "文件 ID（URL 中 file= 或路径中的数字段）。未传 shortLink 时必填。"
      ),
    layerId: z
      .string()
      .optional()
      .describe(
        "可选。图层 ID（只读取 URL 参数 layer_id）。不传或解析不到则仅按 file 维度同步；pageid/page_id 不会被当作 layerId。"
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
  });

  async execute({
    data,
    fileId,
    layerId,
    shortLink,
  }: z.infer<typeof this.schema>) {
    try {
      const link = shortLink?.trim();
      const fid = fileId?.trim();
      const lid = layerId?.trim();

      let finalFileId: string | undefined;
      let finalLayerId: string | undefined;

      if (link) {
        const ids = await httpUtilInstance.extractIdsFromUrl(link);
        finalFileId = this.normalizeFileId(ids.fileId);
        finalLayerId = ids.layerId;
      } else if (fid) {
        finalFileId = this.normalizeFileId(fid);
        finalLayerId = lid || undefined;
      } else {
        throw new Error("请传 shortLink，或至少传 fileId（layerId 可选）");
      }

      if (!finalFileId) {
        throw new Error("Could not determine fileId");
      }

      const result = await httpUtilInstance.postC2d(
        data,
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
      const errorMessage = error?.response?.data ?? error?.message;
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
