import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCommonHeader } from "../src/utils/api";

// esbuild bundle 后 __dirname 是 .test/，仓库根用 process.cwd() 定位
// （npm test 固定在仓库根执行，test/build-integration.mjs 同款假设）。
const REPO_ROOT = process.cwd();

// ---- 客户端自报身份（User-Agent / X-MG-Client）----

test("getCommonHeader: 带 User-Agent 自报 magic-mcp-cli/<version>", () => {
  const headers = getCommonHeader();
  const ua = headers["User-Agent"];
  assert.ok(ua, "User-Agent 应存在");
  assert.match(ua, /^magic-mcp-cli\/\S+/, `UA 应以 magic-mcp-cli/<ver> 开头，实际: ${ua}`);
  assert.ok(ua.includes("node/"), `UA 应含 node 版本段，实际: ${ua}`);
});

test("getCommonHeader: 带 X-MG-Client 且与 UA 同版本", () => {
  const headers = getCommonHeader();
  const client = headers["X-MG-Client"];
  assert.ok(client, "X-MG-Client 应存在");
  assert.match(client, /^magic-mcp-cli\/\S+$/, `X-MG-Client 格式: ${client}`);
  // 两处版本必须一致（同一来源 CLIENT_SELF_ID）
  const uaVersion = headers["User-Agent"].split(" ")[0].split("/")[1];
  const clientVersion = client.split("/")[1];
  assert.equal(uaVersion, clientVersion);
});

test("自报版本号与 package.json 一致（版本漂移检测）", () => {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  const headers = getCommonHeader();
  const clientVersion = headers["X-MG-Client"].split("/")[1];
  assert.equal(clientVersion, pkg.version, "自报版本应取自 package.json，防止两处漂移");
});

test("X-MG-Client 格式可被服务端解析（<name>/<version>，服务端截断 64B）", () => {
  // 服务端 request-source.ts 对 X-MG-Client 的处理：
  //   - 值直接落 clientSelfReport（不解析语义），截断到 64 字节
  //   - UA 归类走 KNOWN_UA_PATTERNS，本 CLI 需在后续把
  //     /magic-mcp-cli\//i 加进服务端 pattern（已在 MR !629 文档注明）
  const headers = getCommonHeader();
  const client = headers["X-MG-Client"];
  assert.ok(client.length <= 64, `自报头应 ≤64 字节（服务端截断阈值），实际 ${client.length}`);
  assert.match(client, /^[\w\-./]+$/, `应只含安全字符（不含控制符/空格），实际: ${client}`);
});

test("getCommonHeader: 自报头不覆盖用户显式 --header 传入的同名头", () => {
  // getEffectiveHeaders() 展开在自报头之后 → 用户显式传的同名头应赢。
  // 缓存已 memoize，无法在运行时改 argv 重建，故断言源码展开顺序（顺序 = 优先级）。
  const src = readFileSync(resolve(REPO_ROOT, "src/utils/api.ts"), "utf8");
  const uaIdx = src.indexOf('"User-Agent":');
  const spreadIdx = src.indexOf("...getEffectiveHeaders()");
  assert.ok(uaIdx > 0 && spreadIdx > 0, "两个关键行都应存在");
  assert.ok(spreadIdx > uaIdx, "getEffectiveHeaders 展开应在自报头之后（显式传入优先）");
});
