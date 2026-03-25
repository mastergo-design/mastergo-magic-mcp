import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const C2D_TOOL_NAME = "mcp__C2d";
const C2D_TOOL_DESCRIPTION = `
使用此工具将代码内容发送到 MasterGo MCP 服务进行 C2D（代码转设计）处理，将用户代码同步到设计稿。

参数说明：
- data：需要转换的代码内容，一般为完整的 HTML 字符串，也可以是其他文本格式。
- fileId / layerId：可选，如果不提供 shortLink，可以直接传入 fileId 和 layerId。
- shortLink：可选，和 getDsl 工具相同的短链接形式（例如 https://{domain}/goto/xxxx），内部会自动解析出 fileId 和 layerId。

工具只负责把 data 原样传给后端服务，并附带解析出的 fileId 和 layerId，不关心后续如何处理或生成设计。
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
      } else if (fid && lid) {
        finalFileId = this.normalizeFileId(fid);
        finalLayerId = lid;
      } else {
        throw new Error(
          "请只传一种：shortLink，或同时传 fileId 与 layerId"
        );
      }

      if (!finalFileId || !finalLayerId) {
        throw new Error("Could not determine fileId or layerId");
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
