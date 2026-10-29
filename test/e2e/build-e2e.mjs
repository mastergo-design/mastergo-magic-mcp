/**
 * E2E 构建脚本：driver.ts → .test/e2e-driver.cjs
 *
 * 与集成测试同款 stub 策略（base-tool / zod），但 api 层用真实实现——真发 HTTP。
 * axios / js-yaml / https-proxy-agent 通过 external 保留 require，运行时由
 * NODE_PATH 指向 master-web/node_modules 解析（仅本地 e2e 使用，不进 CI）。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..", "..");

function loadEsbuild() {
  try {
    return createRequire(pathToFileURL(pkgRoot + "/package.json"))("esbuild");
  } catch {
    const fallbackRoot = process.env.MG_ESBUILD_ROOT || "/Users/liyanfeng/code/mg/master-web/node_modules/";
    return createRequire(pathToFileURL(fallbackRoot))("esbuild");
  }
}

const esbuild = loadEsbuild();
const stub = (name) => path.join(pkgRoot, "test", "stubs", name);

const stubPlugin = {
  name: "e2e-stubs",
  setup(build) {
    build.onResolve({ filter: /^zod$/ }, () => ({ path: stub("zod-stub.ts") }));
    build.onResolve({ filter: /^(\.\/base-tool)$/ }, (args) => {
      if (!args.importer.includes(path.join("src", "tools"))) return null;
      return { path: stub("base-tool-stub.ts") };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(here, "driver.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(pkgRoot, ".test", "e2e-driver.cjs"),
  plugins: [stubPlugin],
  external: ["axios", "js-yaml", "https-proxy-agent"],
  logLevel: "warning",
});

if (result.errors.length > 0) {
  console.error("e2e bundle failed:", result.errors);
  process.exit(1);
}
console.log("e2e bundle ok");
