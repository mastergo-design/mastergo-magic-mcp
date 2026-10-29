/**
 * 集成测试专用的 BaseTool stub（顶替 src/tools/base-tool.ts）。
 *
 * 原 BaseTool import @modelcontextprotocol/sdk（仅 register 使用）；集成测试不调
 * register，stub 去掉 SDK 依赖即可让 bundle 无外部模块。normalizeFileId 逻辑与
 * 原实现保持一致（剥离 "file/" 前缀）——若原实现变更，此处需同步。
 */
export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract schema: any;

  register(_server: unknown): void {
    // 集成测试不注册到 MCP server
  }

  abstract execute(args: any): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;

  protected normalizeFileId(fileId?: string): string | undefined {
    if (!fileId) return fileId;
    return fileId.replace(/^file\//, "");
  }
}
