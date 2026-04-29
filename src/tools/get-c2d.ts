import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";
import fs from "fs";

const C2D_TOOL_NAME = "mcp__C2d";
const C2D_TOOL_DESCRIPTION = `
使用此工具将代码文件发送到 MasterGo MCP 服务进行 C2D（代码转设计）处理，将用户代码同步到设计稿。

参数说明：
- filePath：HTML 文件的完整路径（如 /path/to/file.html），工具会自动读取文件内容并发送给后端。
- fileId： 不提供 shortLink 时至少需要 fileId。layerId 不是必填，没有就不要传。
- layerId： 可选。图层 ID（只读取 URL 参数 layer_id）。不传或解析不到则仅按 file 维度同步；pageid/page_id 不会被当作 layerId。
- shortLink：可选，短链接形式（例如 https://{domain}/goto/xxxx）。
  注意事项：只允许使用 URL 中的 layer_id 参数作为 layerId，严禁将 pageid/page_id 等任何页面 ID 当作 layerId。
  如果短链接或 URL 中没有解析出 layer_id，则不传 layerId。

工具会读取 filePath 指定文件的内容，并传给后端，附带 fileId 与可选的 layerId。
`;

export class GetC2dTool extends BaseTool {
  name = C2D_TOOL_NAME;
  description = C2D_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    filePath: z
      .string()
      .min(1, "filePath 不能为空")
      .describe("HTML 文件的完整路径，工具会读取文件内容并发送给后端"),
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
    sourceLayerId: z
      .string()
      .optional()
      .describe(
        "Source layer ID from URL parameter source_layer_id. When provided, use this instead of layerId."
      ),
    shortLink: z
      .string()
      .optional()
      .describe("Short link (like https://{domain}/goto/LhGgBAK)."),
  });

  async execute({
    filePath,
    fileId,
    layerId,
    sourceLayerId,
    shortLink,
  }: z.infer<typeof this.schema>) {
    try {
      const link = shortLink?.trim();
      const fid = fileId?.trim();
      const lid = layerId?.trim();

      let finalFileId: string | undefined;
      let finalLayerId: string | undefined;
      let finalSourceLayerId: string | undefined = sourceLayerId?.trim() || undefined;

      if (link) {
        const ids = await httpUtilInstance.extractIdsFromUrl(link);
        finalFileId = this.normalizeFileId(ids.fileId);
        finalLayerId = ids.layerId;
        finalSourceLayerId = ids.sourceLayerId ?? finalSourceLayerId;
      } else if (fid) {
        finalFileId = this.normalizeFileId(fid);
        finalLayerId = lid || undefined;
      } else {
        throw new Error("请传 shortLink，或至少传 fileId（layerId 可选）");
      }

      if (!finalFileId) {
        throw new Error("Could not determine fileId");
      }

      // 读取文件内容作为 data 传给接口
      let data: string;
      try {
        data = fs.readFileSync(filePath, "utf-8");
      } catch (readError) {
        throw new Error(`无法读取文件 ${filePath}: ${readError}`);
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
