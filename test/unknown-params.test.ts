/**
 * 未知参数守卫回归测试（issue #137）。
 *
 * 背景：BaseTool.register 旧实现向 SDK 传 this.schema.shape，SDK 用 z.object(shape)
 * 重建 schema（无 passthrough）并在调用 handler 前剥离未知参数，导致各工具 execute
 * 里的「阻断未知参数」检查永远拿不到 rest、沦为死代码（bogusParam 被静默忽略）。
 *
 * 修复：register 改走 server.registerTool + 完整 passthrough schema，并在 wrapper 里
 * 统一做 guardUnknownParams。本测试用真实 SDK（InMemoryTransport + Client）验证：
 *  - 全部 14 个工具可注册，tools/list 广告 passthrough（additionalProperties: true）
 *  - 已知参数正常放行到 execute
 *  - 未知参数被阻断（isError + Unknown parameter(s) 文案），不进入 execute
 *  - _ 前缀元字段不阻断（内部约定）
 *  - getDesignSections 的 sectionIndices 复数误用返回定制文案
 *  - 无参数工具（version_*）同样受守卫保护
 *
 * 工具名与参数清单全部从工具实例动态派生（schema.shape），避免硬编码随工具演进漂移。
 *
 * bundle 由 test/build-unknown-params.mjs 完成：真实 zod + 真实 SDK，仅把
 * ../utils/api（axios/网络副作用）替换为内存 stub；markdown/package.json 导入由
 * esbuild 的 text/json loader 内联。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { integrationCalls, integrationFixtures, resetIntegrationFixtures } from "./stubs/api-stub";

import { ApplyDesignTool } from "../src/tools/apply-design";
import { DownloadExportAssetsTool } from "../src/tools/download-export-assets";
import { ExtractSvgTool } from "../src/tools/extract-svg";
import { GetC2dTool } from "../src/tools/get-c2d";
import { GetComponentLinkTool } from "../src/tools/get-component-link";
import { GetComponentWorkflowTool } from "../src/tools/get-component-workflow";
import { GetD2cTool } from "../src/tools/get-d2c";
import { GetDesignSectionsTool } from "../src/tools/get-design-sections";
import { GetDslTool } from "../src/tools/get-dsl";
import { GetExportListTool } from "../src/tools/get-export-list";
import { GetFlutterWorkflowTool } from "../src/tools/get-flutter-workflow";
import { GetMetaTool } from "../src/tools/get-meta";
import { GetPageLayersTool } from "../src/tools/get-page-layers";
import { GetVersionTool } from "../src/tools/get-version";

import type { BaseTool } from "../src/tools/base-tool";

function allTools(): BaseTool[] {
  return [
    new GetVersionTool(),
    new GetDesignSectionsTool(),
    new GetPageLayersTool(),
    new GetDslTool(),
    new GetD2cTool(),
    new GetC2dTool(),
    new GetComponentLinkTool(),
    new GetMetaTool(),
    new GetComponentWorkflowTool(),
    new GetFlutterWorkflowTool(),
    new ExtractSvgTool(),
    new ApplyDesignTool(),
    new DownloadExportAssetsTool(),
    new GetExportListTool(),
  ];
}

/** zod v3：字段是否可选（必填字段在 SDK 层会先因缺参被拒，构造用例时需补足）。 */
function requiredKeys(tool: BaseTool): string[] {
  const shape = (tool.schema as any).shape as Record<string, any>;
  return Object.keys(shape).filter((k) => {
    const field = shape[k];
    return typeof field?.isOptional === "function" && !field.isOptional();
  });
}

/** {bogusParam: x} + 必填参数占位值，保证用例能穿过 SDK 的必填校验抵达守卫。 */
function bogusArgs(tool: BaseTool): Record<string, unknown> {
  const args: Record<string, unknown> = { bogusParam: "x" };
  for (const k of requiredKeys(tool)) args[k] = "x";
  return args;
}

function newServerWith(tools: BaseTool[]): McpServer {
  const server = new McpServer({ name: "unknown-params-test-server", version: "0.0.0" });
  for (const tool of tools) tool.register(server);
  return server;
}

async function makeClient(server: McpServer) {
  const client = new Client({ name: "unknown-params-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** 用 getPageLayers 的最小合法 fixture 复位 stub（execute 返回值须能通过 SDK 响应校验）。 */
function resetFixtures() {
  resetIntegrationFixtures();
  integrationCalls.length = 0;
  integrationFixtures.pageLayers = { layers: [], pageName: "Demo Page", totalLayers: 0 };
}

const parseErrorText = (text: string) => JSON.parse(text).error as string;

test("all tools register; tools/list advertises passthrough (additionalProperties: true)", async () => {
  resetFixtures();
  const tools = allTools();
  const client = await makeClient(newServerWith(tools));

  const { tools: listed } = await client.listTools();
  assert.deepEqual(
    listed.map((t) => t.name).sort(),
    tools.map((t) => t.name).sort()
  );
  for (const t of listed) {
    assert.equal(
      t.inputSchema.additionalProperties,
      true,
      `${t.name} inputSchema should be passthrough`
    );
  }
  await client.close();
});

test("known params reach execute untouched", async () => {
  resetFixtures();
  const client = await makeClient(newServerWith([new GetPageLayersTool()]));

  const result = (await client.callTool({
    name: "mcp__getPageLayers",
    arguments: { fileId: "file/abc123", layerId: "40:1", format: "json" },
  })) as any;
  assert.notEqual(result.isError, true);
  assert.equal(integrationCalls.length, 1);
  assert.equal(integrationCalls[0].fileId, "abc123");
  await client.close();
});

test("unknown param is blocked with isError and named in the error text (regression for issue #137)", async () => {
  resetFixtures();
  const client = await makeClient(newServerWith([new GetPageLayersTool()]));

  const result = (await client.callTool({
    name: "mcp__getPageLayers",
    arguments: { fileId: "abc123", layerId: "40:1", bogusParam: "x" },
  })) as any;
  assert.equal(result.isError, true, "unknown param must not be silently dropped");
  const error = parseErrorText(result.content[0].text);
  assert.match(error, /Unknown parameter\(s\): bogusParam/);
  assert.match(error, /fileId, layerId, sourceLayerId, shortLink, format/);
  assert.equal(integrationCalls.length, 0, "execute must not run when guard trips");
  await client.close();
});

test("every tool blocks unknown params and lists its accepted params", async () => {
  resetFixtures();
  const tools = allTools();
  const client = await makeClient(newServerWith(tools));

  for (const tool of tools) {
    const accepted = Object.keys((tool.schema as any).shape);
    const result = (await client.callTool({
      name: tool.name,
      arguments: bogusArgs(tool),
    })) as any;
    assert.equal(result.isError, true, `${tool.name} should block bogusParam`);
    const error = parseErrorText(result.content[0].text);
    assert.match(error, /Unknown parameter\(s\): bogusParam/, `${tool.name}: ${error}`);
    for (const p of accepted) {
      assert.match(error, new RegExp(`\\b${p}\\b`), `${tool.name} should list ${p}`);
    }
  }
  assert.equal(integrationCalls.length, 0);
  await client.close();
});

test("underscore-prefixed meta fields are allowed through (internal convention)", async () => {
  resetFixtures();
  const client = await makeClient(newServerWith([new GetPageLayersTool()]));

  const result = (await client.callTool({
    name: "mcp__getPageLayers",
    arguments: { fileId: "abc123", layerId: "40:1", _fromPageParam: true },
  })) as any;
  assert.notEqual(result.isError, true);
  assert.equal(integrationCalls.length, 1);
  await client.close();
});

test("getDesignSections sectionIndices misuse returns the dedicated hint", async () => {
  resetFixtures();
  const client = await makeClient(newServerWith([new GetDesignSectionsTool()]));

  const result = (await client.callTool({
    name: "mcp__getDesignSections",
    arguments: { fileId: "abc123", layerId: "40:1", sectionIndices: [15, 16] },
  })) as any;
  assert.equal(result.isError, true);
  const error = parseErrorText(result.content[0].text);
  assert.match(error, /sectionIndices.*NOT supported/);
  assert.match(error, /sectionIndex.*SINGULAR/);
  assert.equal(integrationCalls.length, 0);
  await client.close();
});

test("zero-param tool (version_*) still works and blocks stray params", async () => {
  resetFixtures();
  const tool = new GetVersionTool();
  const client = await makeClient(newServerWith([tool]));

  const ok = (await client.callTool({ name: tool.name, arguments: {} })) as any;
  assert.notEqual(ok.isError, true);

  const blocked = (await client.callTool({
    name: tool.name,
    arguments: { bogusParam: "x" },
  })) as any;
  assert.equal(blocked.isError, true);
  assert.match(parseErrorText(blocked.content[0].text), /Unknown parameter\(s\): bogusParam/);
  await client.close();
});
