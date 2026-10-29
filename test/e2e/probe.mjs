/**
 * MCP 协议层探针：spawn 真实 dist/index.js，用裸 JSON-RPC 走
 * initialize → notifications/initialized → tools/list → tools/call。
 * 验证：协议握手、工具注册、SERVER_INSTRUCTIONS 是否为新版、pageRestore 是否生效。
 */
import { spawn } from "node:child_process";
import readline from "node:readline";

const DIST = process.argv[2];
const FILE_ID = process.argv[3];
const PAGE_ID = process.argv[4];

const child = spawn("node", [DIST, "--url=https://mastergo.com"], {
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
});

const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

child.stderr.on("data", () => { /* debug noise */ });

function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify(payload) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
}

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "1.0" },
  }, 20000);
  const info = init.result?.serverInfo || {};
  const instr = init.result?.instructions || "";
  console.log(`[1] initialize: server=${info.name} v${info.version}`);
  const hasNewContract = instr.includes("AUTOMATED plan") || instr.includes("pageRestore fields");
  console.log(`[2] instructions: newPageRestoreContract=${hasNewContract} (len=${instr.length})`);

  notify("notifications/initialized");

  const list = await rpc("tools/list", {}, 20000);
  const tools = list.result?.tools || [];
  console.log(`[3] tools/list: ${tools.length} tools -> ${tools.map((t) => t.name).join(", ")}`);

  const call = await rpc("tools/call", {
    name: "mcp__getPageLayers",
    arguments: { fileId: FILE_ID, layerId: PAGE_ID },
  }, 180000);
  const text = call.result?.content?.[0]?.text || "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (parsed) {
    console.log(`[4] tools/call getPageLayers: totalLayers=${parsed.totalLayers} isError=${Boolean(call.result?.isError)}`);
    console.log(`[5] pageRestore injected: ${parsed.pageRestore ? "YES -> " + JSON.stringify(parsed.pageRestore) : "NO"}`);
    console.log(`[6] nextAction: ${(parsed.nextAction || "").slice(0, 160)}`);
  } else {
    console.log(`[4] tools/call raw: ${text.slice(0, 300)}`);
  }
} catch (e) {
  console.error("[probe] FAILED:", e.message);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  setTimeout(() => process.exit(), 300);
}
