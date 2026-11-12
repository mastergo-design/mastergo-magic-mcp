import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyToolPrefix } from "../utils/tool-prefix";

/** 工具错误响应（isError + 文本化 error JSON），由未知参数守卫返回。 */
export interface ToolErrorResult {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
}

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract schema: z.ZodObject<any>;

  register(server: McpServer) {
    server.registerTool(
      this.name,
      {
        // 描述文本里引用的是带 `mcp__` 前缀的工具名，需随当前前缀设置同步改写，
        // 否则无前缀模式下模型会被引导去调用不存在的 `mcp__xxx` 工具。
        description: applyToolPrefix(this.description),
        // 必须传完整 schema（并强制 passthrough），不能传 this.schema.shape（issue #137）：
        // - 传 shape 时 SDK 会用 z.object(shape) 重建 schema（无 passthrough），未知参数在
        //   SDK 解析阶段即被静默剥离，下面的守卫拿不到多余键，沦为死代码；
        // - 传完整 passthrough schema 后未知键保留到 wrapper，由 guardUnknownParams 统一
        //   阻断并返回「Unknown parameter(s)」错误文案，tools/list 广告的
        //   additionalProperties 也同步为 true；
        // - server.tool(name, desc, shape, cb) 在 SDK 中已标记 deprecated，统一走 registerTool。
        inputSchema: this.schema.passthrough(),
      },
      // 未知参数阻断（对全部工具统一生效）：在进入 execute 前校验入参键，
      // 命中即返回 isError 响应，不再静默忽略（见 guardUnknownParams 注释）。
      (args: z.infer<typeof this.schema>) => {
        const guard = this.guardUnknownParams(args);
        if (guard) return Promise.resolve(guard);
        return this.execute(args);
      }
    );
  }

  abstract execute(args: z.infer<typeof this.schema>): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;

  /**
   * 未知参数守卫：入参键里凡是 schema 未定义、且不带 `_` 前缀（内部元字段约定）的，
   * 一律阻断并返回标准 isError 响应。
   *
   * 依赖 register 侧传入完整 passthrough schema（见 register 注释）：若 SDK 剥离了未知键，
   * 这里将永远看不到多余键，守卫退化为死代码。接受的参数清单直接从 schema shape 派生，
   * 无需各工具维护文案。
   */
  protected guardUnknownParams(args: unknown): ToolErrorResult | null {
    if (typeof args !== "object" || args === null) return null;
    const unknownKeys = Object.keys(args as Record<string, unknown>).filter(
      (k) => !k.startsWith("_") && !(k in this.schema.shape)
    );
    if (unknownKeys.length === 0) return null;
    const accepted = Object.keys(this.schema.shape).join(", ");
    const acceptedText = accepted
      ? `This tool only accepts: ${accepted}.`
      : "This tool accepts no parameters.";
    const errorText =
      this.unknownParamHint(unknownKeys) ??
      `Unknown parameter(s): ${unknownKeys.join(", ")}. ${acceptedText} Remove the unknown parameter(s) and retry.`;
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: errorText }) }],
    };
  }

  /**
   * 工具可覆写：为特定高频误用参数返回定制提示文案（如 getDesignSections 的
   * 复数 sectionIndices）；返回 undefined 时使用通用「Unknown parameter(s)」文案。
   */
  protected unknownParamHint(_unknownKeys: string[]): string | undefined {
    return undefined;
  }

  protected normalizeFileId(fileId?: string): string | undefined {
    if (!fileId) return fileId;
    return fileId.replace(/^file\//, "");
  }
}
