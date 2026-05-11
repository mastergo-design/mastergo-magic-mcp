# Project Rules

## Code Style

- All imports must be placed at the top of the file. Do not use dynamic `import()` or write `import` statements in the middle of code.

## Build

- build.js 中的注释必须保留，不要删除。新增功能时，在原有注释结构基础上扩展。
- `npm run build` — 生产构建（压缩、无 sourcemap）
- `npm run build:watch` — 开发模式（不压缩、开启 sourcemap、文件变更自动 rebuild）
