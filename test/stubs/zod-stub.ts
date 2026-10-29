/**
 * 集成测试专用的最小 zod stub。
 *
 * 背景：集成测试直接调用工具的 execute()（MCP SDK 在外层做参数校验，这里跳过），
 * 但工具模块在加载时会构建 zod schema。为让测试 bundle 完全自包含（不依赖
 * node_modules，CI 与本地一致），用 Proxy 链式 stub 顶替——任何属性访问/调用都
 * 返回自身，schema 构建不报错，且运行时永不参与校验。
 *
 * ⚠️ 仅限测试使用：真实 zod 的类型与校验语义不在本 stub 的责任范围内。
 */
const chain: any = new Proxy(function stub() {}, {
  get(_target, prop) {
    // 防 thenable 误判（任何 await chain 的场景都会挂起）
    if (prop === "then") return undefined;
    return chain;
  },
  apply() {
    return chain;
  },
});

export const z: any = chain;
export default z;
