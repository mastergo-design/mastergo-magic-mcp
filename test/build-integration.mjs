/**
 * 集成测试构建脚本：page-restore-integration.test.ts → .test/*.cjs
 *
 * 与 package.json 主 test 命令的区别：用 onResolve 插件把工具的依赖顶替为
 * test/stubs/ 下的自包含 stub（zod / js-yaml / base-tool / api），使 bundle
 * 完全无 node_modules 依赖，CI 与本地行为一致。
 *
 * esbuild 解析顺序：CI 直接 require("esbuild")；本地沙箱无 node_modules 时
 * fallback 到 master-web 的 esbuild（仅本地兜底路径，CI 不会走到）。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");

function loadEsbuild() {
  try {
    return createRequire(pathToFileURL(pkgRoot + "/package.json"))("esbuild");
  } catch {
    // 本地沙箱兜底：借用 master-web 的 esbuild（路径不存在时明确报错）。
    const fallbackRoot = process.env.MG_ESBUILD_ROOT || "/Users/liyanfeng/code/mg/master-web/node_modules/";
    return createRequire(pathToFileURL(fallbackRoot))("esbuild");
  }
}

const esbuild = loadEsbuild();
const stub = (name) => path.join(here, "stubs", name);

/**
 * 顶替规则：
 * - 包级：zod / js-yaml → stub（工具模块加载期构建 schema 用，运行时不校验）
 * - 相对路径：仅 src/tools 内对 "./base-tool" 与 "../utils/api" 的导入 → stub
 *   （限 importer 目录，避免误伤其它位置的潜在同名导入）
 */
const stubPlugin = {
  name: "integration-stubs",
  setup(build) {
    build.onResolve({ filter: /^(zod|js-yaml)$/ }, (args) => ({
      path: stub(args.path === "zod" ? "zod-stub.ts" : "js-yaml-stub.ts"),
    }));
    build.onResolve({ filter: /^(\.\/base-tool|\.\.\/utils\/api)$/ }, (args) => {
      if (!args.importer.includes(path.join("src", "tools"))) return null;
      if (args.path === "./base-tool") return { path: stub("base-tool-stub.ts") };
      return { path: stub("api-stub.ts") };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(here, "page-restore-integration.test.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(pkgRoot, ".test", "page-restore-integration.test.cjs"),
  plugins: [stubPlugin],
  logLevel: "warning",
});

if (result.errors.length > 0) {
  console.error("integration bundle failed:", result.errors);
  process.exit(1);
}
console.log("integration bundle ok");
