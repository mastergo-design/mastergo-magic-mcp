# Project Rules

## 双项目同步

- 本项目 (`mastergo-magic-mcp`) 和 `frontend-mcp-server` (`../../frontend-mcp-server/`) 共享 MCP 工具协议和 LLM prompt。
- 涉及以下文件的变更**必须同步到两个项目**：
  - `SERVER_INSTRUCTIONS`（LLM 系统提示词）— 分别在 `src/index.ts` 和 `src/mcp-sse/tools/index.ts`
  - `buildDslRules()`（DSL 返回规则）— 分别在 `src/utils/api.ts` 和 `src/mcp-sse/tools/get-design-sections.ts` 的 `rules` 数组
  - `meta.md`（工作流指引）— 分别在 `src/markdown/meta.md` 和 `src/mcp-sse/markdown/meta.md`
  - 工具描述（`*_TOOL_DESCRIPTION`）— 两个项目中对应的 tool 文件
- 修改一处后，必须检查另一个项目的对应文件并同步变更。

## 文档同步（README 双语）

- 本项目同时维护 `README.md`（英文）和 `README.zh-CN.md`（中文），两份文档内容必须保持一致，仅语言不同。
- **更新 `README.md` 时，必须同步更新 `README.zh-CN.md`**（反之亦然）。新增小节、修改参数说明、调整结构等任何内容变更都要在另一份文档中对应同步。
- 检查清单：改动一处后，立即检查另一份文档的对应位置是否需要同步。

## Code Style

- All imports must be placed at the top of the file. Do not use dynamic `import()` or write `import` statements in the middle of code.

## Lint（每次改动必跑）

- **每次代码改动后，必须执行 `npm run lint`，且 0 error 才算通过**（warning 不阻断，但应尽量消除）。`npm run lint:fix` 可自动修复可修复项（格式、简单规则）。
- 提交/合并前必做清单：`npm run lint`（0 error）+ `npm run build`（构建通过）。CI（`.github/workflows/ci.yml`）已强制 lint → build，本地先跑可避免 CI 红。
- 规则定义在 `.eslintrc.json`：`eslint:recommended` + `plugin:@typescript-eslint/recommended`。已知约定：
  - `@typescript-eslint/no-explicit-any` 为 **warn**（本项目 catch 子句、API 边界大量使用 `any`，属有意为之；新增代码能具象化类型时尽量不用 `any`）。
  - `@typescript-eslint/no-unused-vars` 为 **error**（未使用变量是真实缺陷；故意忽略的参数/变量用 `_` 前缀）。
- 新增/调整 lint 规则时：先 `npm run lint` 看全量影响，确认不会引入大量历史 error；若引入，要么修复代码、要么在该规则上加注释说明降级为 warn。

## Build

- **新增功能或依赖时，必须检查 `build.js` 是否需要同步更新**。检查项：`external` 列表（仅排除 Node 内建模块，所有第三方依赖默认打包）、`loader`、`entryPoints`、`target`、`resolveExtensions`、`minify`/`sourcemap`。
  - 纯 JS 依赖（如 `js-yaml`）会随 `bundle: true` 自动打进 `dist/index.js`，无需改动 `build.js` —— 但仍必须**显式确认**它没有被误加进 `external`，且构建产物体积合理、`npm run build` 通过。
  - 涉及**原生模块（.node）、新的文件类型入口、或需要 external 化的依赖**时，必须同步修改 `build.js` 并在对应位置扩展注释。
- build.js 中的注释必须保留，不要删除。新增功能时，在原有注释结构基础上扩展。
- `npm run build` — 生产构建（压缩、无 sourcemap）
- `npm run build:watch` — 开发模式（不压缩、开启 sourcemap、文件变更自动 rebuild）

## 输出格式验证（format / 序列化）

- **任何涉及 `format`（json/yaml/tree）或按 payload shape 分发的改动，必须用真实 server 响应验证所有 shape，不能只用构造样例。**（历史教训：构造的 `{nodes}` 样例通过测试，但真实响应把节点树嵌在 `dsl.nodes` / `sections` 下，导致 tree 静默回退 JSON。）
- 必须覆盖的真实响应 shape（用真实 fileId/layerId，经 stdio 驱动 `dist/index.js`，或直连 `/mcp/*` 路由）：
  - `mcp__getDesignSections` Mode 1 — section 列表：`{ sections, totalSections, rootMetadata, rootContainer, splitContainers }`
  - `mcp__getDesignSections` Mode 2 — 单个 section：`{ sectionIndex, section, dsl: { styles, nodes }, ... }`（节点在 **`dsl.nodes`**）
  - `mcp__getDsl` — `{ dsl: { styles, nodes }, componentDocumentLinks, rules }`（节点在 `dsl.nodes`）
  - `mcp__getDesignSvgs` — `{ svgs: { key: value }, nodeCount }`，含空缓存 `{ message, svgs: {}, nodeCount: 0 }`
  - `mcp__getDesignTexts` — `{ texts: { key: value }, textCount }`，含空缓存
  - `mcp__extractSvg` — `{ count, svgs: [{ name, id, svg }] }`（`svgs` 是**数组**，走 `svgListToTree`，区别于 getDesignSvgs 的对象 map）
  - `mcp__getMeta` — `{ result, rules }`（`rules` 是 markdown 字符串）：`tree` 下回退 JSON（不可把 markdown 塞进 tree 布局），`json`/`yaml` 正常
- 验证清单：每种 shape 用 `--format=json|yaml|tree` 各跑一次，确认：① 输出符合该格式（不是 JSON 回退）；② 无损往返（yaml 可 `yaml.load` 还原，tree 的 SVG/text 值逐字节保留）；③ dispatch 能穿透 `dsl`/`nodes`/`sections`/`svgs`/`texts` 等 wrapper 键。
