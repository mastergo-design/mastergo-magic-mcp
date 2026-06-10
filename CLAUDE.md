# Project Rules

## 双项目同步

- 本项目 (`mastergo-magic-mcp`) 和 `frontend-mcp-server` (`../../frontend-mcp-server/`) 共享 MCP 工具协议和 LLM prompt。
- 涉及以下文件的变更**必须同步到两个项目**：
  - `SERVER_INSTRUCTIONS`（LLM 系统提示词）— 分别在 `src/index.ts` 和 `src/mcp-sse/tools/index.ts`
  - `buildDslRules()`（DSL 返回规则）— 分别在 `src/utils/api.ts` 和 `src/mcp-sse/tools/get-design-sections.ts` 的 `rules` 数组
  - `meta.md`（工作流指引）— 分别在 `src/markdown/meta.md` 和 `src/mcp-sse/markdown/meta.md`
  - 工具描述（`*_TOOL_DESCRIPTION`）— 两个项目中对应的 tool 文件
- 修改一处后，必须检查另一个项目的对应文件并同步变更。

## Code Style

- All imports must be placed at the top of the file. Do not use dynamic `import()` or write `import` statements in the middle of code.

## Build

- build.js 中的注释必须保留，不要删除。新增功能时，在原有注释结构基础上扩展。
- `npm run build` — 生产构建（压缩、无 sourcemap）
- `npm run build:watch` — 开发模式（不压缩、开启 sourcemap、文件变更自动 rebuild）
