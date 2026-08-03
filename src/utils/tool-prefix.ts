/**
 * 工具名前缀工具。
 *
 * 默认所有工具名为 `mcp__xxx` 形式（如 `mcp__getDesignSections`）。部分 MCP 客户端
 * （如 Grok Build）要求工具全限定名 `server__tool` 中恰好只有一个 `__` 分隔符——工具名
 * 自身再含 `__`（如 `mcp__getDsl`）会被静默跳过注册（见 issue #115）。
 *
 * 提供 `--no-prefix` 命令行参数 / `MG_NO_PREFIX` 环境变量，开启后：
 *   - 工具名不带 `mcp__` 前缀（`getDsl`、`getDesignSections` …）；
 *   - 所有指令/描述文本中的 `mcp__` 引用同步改写，避免模型调用不存在的工具名。
 */

let _noPrefix: boolean | null = null;

function parseEnvNoPrefix(): boolean {
  const v = process.env.MG_NO_PREFIX;
  return v === "1" || v === "true" || v === "yes";
}

function resolveNoPrefix(): boolean {
  if (_noPrefix !== null) return _noPrefix;
  _noPrefix = parseEnvNoPrefix();
  return _noPrefix;
}

/** 解析出 `--no-prefix` 后调用，覆盖环境变量。 */
export function setNoPrefix(v: boolean): void {
  _noPrefix = v;
  // 同步 env，保证运行时其它模块（如 api.ts 的 buildDslRules）读取一致。
  process.env.MG_NO_PREFIX = v ? "1" : "0";
}

/** 重置缓存的解析结果，回到从环境变量读取。测试用。 */
export function resetNoPrefix(): void {
  _noPrefix = null;
}

/** 当前是否启用无前缀模式。 */
export function getNoPrefix(): boolean {
  return resolveNoPrefix();
}

/** 当前工具名前缀：无前缀模式下为空串，否则为 `mcp__`。 */
export function getToolPrefix(): string {
  return getNoPrefix() ? "" : "mcp__";
}

/** 生成工具名：`getToolPrefix() + base`，例如 base="getDsl" → "mcp__getDsl" 或 "getDsl"。 */
export function toolName(base: string): string {
  return `${getToolPrefix()}${base}`;
}

/**
 * 把一段含 `mcp__` 工具名引用的文本改写成当前前缀下的正确引用。
 * 无前缀模式下 `mcp__getDsl` → `getDsl`；默认模式下原样返回。
 */
export function applyToolPrefix(text: string): string {
  const prefix = getToolPrefix();
  return prefix === "mcp__" ? text : text.replace(/mcp__/g, prefix);
}
