import { z } from "zod";
import { BaseTool } from "./base-tool";
import { httpUtilInstance } from "../utils/api";

const D2C_TOOL_NAME = "mcp__getD2c";
const D2C_TOOL_DESCRIPTION = `
使用此工具从 MasterGo 获取 D2C 数据。
返回结果是一个 JSON 字符串，示例结构为：
{
   "code": "00000",
    "message": "✅ 请求成功",
    "status": 200,
    "data": {
        "payload": {
          "code": "code string",
          "contentId": "contentId string",
          "frameType": "frameType string",
          "image": {
                    "396102588418ac9fff2dead11ae585ce.png": "https://image-resource.mastergo.com/164019242047676/169610758561058/396102588418ac9fff2dead11ae585ce.png",
                    "397816b5a878c61c85b8dba8c05d7347.png": "https://image-resource.mastergo.com/164019242047676/169610758561058/397816b5a878c61c85b8dba8c05d7347.png"
                },
          "svg": {
                    "396102588418ac9fff2dead11ae585ce.svg": "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><circle cx='50' cy='50' r='40' fill='red'/></svg>",
                },
          "resourcePath": {
                "image": "./asset/images/",
                "svg": "./asset/icons/",                  
                "shape": ""
          },
        }
      }
  }
}
使用此工具后，请按以下 todo 执行：
1）为每个资源（返回的svg和image）在本地按 resourcePath 落盘：
   - 确保 resourcePath 对应目录存在；
   - 将返回的真实svg按照resourcePath的svg目录落盘；
   - 将返回的真实image按照resourcePath的image目录落盘；
2）使用 code 字段进行代码生成；
`;

export class GetD2cTool extends BaseTool {
  name = D2C_TOOL_NAME;
  description = D2C_TOOL_DESCRIPTION;

  constructor() {
    super();
  }

  schema = z.object({
    contentId: z
      .string()
      .describe(
        "MasterGo D2C contentId，例如 mastergo://getd2c/176452330285910-2-2845 中的 176452330285910-2-2845。"
      ),
    documentId: z
      .string()
      .describe(
        "MasterGo 文档 ID，通常为 contentId 的第一段，例如 contentId 为 176452330285910-2-9032 时 documentId 为 176452330285910。"
      ),
  });

  async execute({
    contentId,
    documentId,
  }: z.infer<typeof this.schema>) {
    try {
      if (!contentId) {
        throw new Error("contentId 不能为空");
      }
      if (!documentId) {
        throw new Error("documentId 不能为空");
      }

      const d2c = await httpUtilInstance.getD2c(
        contentId,
        documentId
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(d2c),
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
      };    }
  }
}