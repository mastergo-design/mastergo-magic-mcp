import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 单次 tools/call 请求内的 MasterGo API token。
 * 由 BaseTool 在 handler 入口根据 MCP `extra._meta.userToken` 写入；
 * HTTP 请求通过 `getCommonHeader()` 优先读取，未设置时回退 env / argv。
 */
export const requestTokenStore = new AsyncLocalStorage<string | undefined>();
