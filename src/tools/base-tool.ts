import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyToolPrefix } from "../utils/tool-prefix";

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract schema: z.ZodObject<any>;

  register(server: McpServer) {
    server.tool(
      this.name,
      // 描述文本里引用的是带 `mcp__` 前缀的工具名，需随当前前缀设置同步改写，
      // 否则无前缀模式下模型会被引导去调用不存在的 `mcp__xxx` 工具。
      applyToolPrefix(this.description),
      this.schema.shape,
      this.execute.bind(this)
    );
  }

  abstract execute(args: z.infer<typeof this.schema>): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;

  protected normalizeFileId(fileId?: string): string | undefined {
    if (!fileId) return fileId;
    return fileId.replace(/^file\//, "");
  }
}
