/**
 * 未知参数守卫回归测试（test/unknown-params.test.ts）的 bundle 脚本。
 *
 * 与 build-integration.mjs 的区别：本测试验证的正是 SDK 注册路径本身（issue #137 的
 * 根因在 SDK 的 schema 重建），所以**保留真实 zod 与真实 @modelcontextprotocol/sdk**，
 * 仅顶替：
 *   - ../utils/api → 内存 stub（避免 axios 代理副作用与真实网络）
 *   - ../markdown/*.md 与 ../package.json → 文本/JSON 内联模块
 *     （esbuild 原生支持 .md/.json loader，这里 alias 只是为了不依赖 build.js 配置）
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

const stubPlugin = {
  name: "unknown-params-stubs",
  setup(build) {
    // 网络层顶替：axios/代理副作用换内存 stub（schema/SDK 链路保持真实）。
    build.onResolve({ filter: /^\.\.\/utils\/api$/ }, (args) => {
      if (!args.importer.includes(path.join("src", "tools"))) return null;
      return { path: stub("api-stub.ts") };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(here, "unknown-params.test.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(pkgRoot, ".test", "unknown-params.test.cjs"),
  plugins: [stubPlugin],
  // markdown / json 内联为文本/JSON（getMeta 等工具的静态导入），不依赖 build.js 配置。
  loader: { ".md": "text", ".json": "json" },
  logLevel: "warning",
});

if (result.errors.length > 0) {
  console.error("unknown-params bundle failed:", result.errors);
  process.exit(1);
}
console.log("unknown-params bundle ok");
