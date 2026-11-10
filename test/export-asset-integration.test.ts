import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 必须在任何 downloadExportAssets execute 之前设置（outDir 安全校验按此解析允许根）。
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mg-export-asset-it-"));
process.env.MG_OUTPUT_ROOT = outputRoot;

import { DownloadExportAssetsTool } from "../src/tools/download-export-assets";
import { GetExportListTool } from "../src/tools/get-export-list";
import { integrationFixtures, integrationCalls, resetIntegrationFixtures } from "./stubs/api-stub";

/**
 * 切图工具链的集成测试（真实工具 execute 路径 + stub 化的 api 层）。
 *
 * 重点回归（2026-11-09 dev 实测踩到的真实 bug）：
 * 缓存为空时，服务端 `GET /mcp/export-asset` 返回 **404**。首版实现把 404 当异常，
 * axios 直接抛错 → 代码根本走不到「自动渲染」那段 → 用户看到 404 而不是自动补渲染。
 * 这里锁定两条契约：
 *   ① 404 必须被归一化成空清单，从而触发 renderExportAssets
 *   ② 渲染后重新读清单即可下载落盘
 */

const FILE_ID = "205528886216145";
const LAYER_ID = "M";

function resetAll(): void {
  resetIntegrationFixtures();
}

/** 一次成功的渲染返回（形状对齐 GetExportAssetsResult）。 */
function renderResult() {
  return {
    fileId: FILE_ID,
    layerId: LAYER_ID,
    scope: "page",
    total: 1,
    dir: "/tmp/mg-export-assets/205528886216145",
    assets: [
      {
        exportId: "2:0",
        layerId: "1:3",
        format: "png",
        width: 207,
        height: 278,
        bytes: 852,
        fileName: "1-3-2-0.png",
      },
    ],
    skipped: [],
  };
}

/** 渲染后可下载的清单（第二次 listExportAssets 的返回）。 */
function listAfterRender() {
  return {
    fileId: FILE_ID,
    layerId: LAYER_ID,
    total: 1,
    assets: [
      {
        exportId: "2:0",
        layerId: "1:3",
        format: "png",
        width: 207,
        height: 278,
        bytes: 852,
        fileName: "1-3-2-0.png",
      },
    ],
  };
}

/** 空清单（等价于服务端 404 归一化后的结果）。 */
function emptyList() {
  return { fileId: FILE_ID, layerId: LAYER_ID, total: 0, assets: [] };
}

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function parseToolText(res: any): any {
  return JSON.parse(res.content[0].text);
}

test("缓存为空时自动渲染，然后下载落盘（回归 404 未触发自动渲染的 bug）", async () => {
  resetAll();
  // 第一次 list 返回空（模拟服务端 404 归一化），渲染后再返回真实清单
  integrationFixtures.exportAssetList = [emptyList(), listAfterRender()];
  integrationFixtures.exportRender = renderResult();
  integrationFixtures.exportAssetDownload = {
    data: PNG_1x1,
    contentType: "image/png",
    contentDisposition: 'attachment; filename="1-3-2-0.png"',
  };

  const tool = new DownloadExportAssetsTool();
  const res = await tool.execute({
    fileId: FILE_ID,
    layerId: LAYER_ID,
    outDir: "auto-render",
  } as any);

  assert.equal(res.isError, undefined, "不应报错");
  const out = parseToolText(res);

  // 关键断言：必须真的触发了渲染
  const renderCalls = integrationCalls.filter((c) => c.method === "renderExportAssets");
  assert.equal(renderCalls.length, 1, "缓存为空时必须自动渲染恰好一次");
  assert.equal(out.autoRendered, true, "结果需标记本次是自动渲染");

  // 渲染后重新读清单（listExportAssets 应被调用两次：渲染前 + 渲染后）
  const listCalls = integrationCalls.filter((c) => c.method === "listExportAssets");
  assert.equal(listCalls.length, 2, "渲染前后各读一次清单");

  // 下载并落盘
  assert.equal(out.downloadedCount, 1);
  const asset = out.assets[0];
  assert.equal(asset.exportId, "2:0");
  assert.equal(asset.layerId, "1:3", "layerId 必须回填（对应服务端 !528 修的那个字段）");
  assert.equal(asset.bytes, PNG_1x1.length);
  assert.ok(fs.existsSync(asset.filePath), "文件必须真实落盘");
  assert.deepEqual(
    fs.readFileSync(asset.filePath).subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "落盘内容必须是 PNG 魔数",
  );
});

test("缓存已有时不重复渲染（避免每次都白渲染一次）", async () => {
  resetAll();
  integrationFixtures.exportAssetList = listAfterRender();
  integrationFixtures.exportAssetDownload = {
    data: PNG_1x1,
    contentType: "image/png",
    contentDisposition: 'attachment; filename="x.png"',
  };

  const tool = new DownloadExportAssetsTool();
  const res = await tool.execute({ fileId: FILE_ID, layerId: LAYER_ID, outDir: "cached" } as any);

  const out = parseToolText(res);
  assert.equal(out.autoRendered, false, "缓存命中时不应标记自动渲染");
  assert.equal(
    integrationCalls.filter((c) => c.method === "renderExportAssets").length,
    0,
    "缓存命中时不应调用渲染",
  );
  assert.equal(out.downloadedCount, 1);
});

test("真的没有切图时，明确说明而不是让 LLM 猜", async () => {
  resetAll();
  // 渲染也拿不到东西：total=0
  integrationFixtures.exportAssetList = emptyList();
  integrationFixtures.exportRender = {
    fileId: FILE_ID,
    layerId: LAYER_ID,
    scope: "page",
    total: 0,
    assets: [],
    skipped: [],
    note: "No Export settings found in this scope.",
  };

  const tool = new DownloadExportAssetsTool();
  const res = await tool.execute({ fileId: FILE_ID, layerId: LAYER_ID } as any);

  assert.equal(res.isError, true, "没有切图应返回 isError 让 LLM 明确感知");
  const out = parseToolText(res);
  assert.equal(out.totalInScope, 0);
  assert.match(out.error, /NO Export settings/i, "必须明确告知该范围没有切图配置");
  assert.match(out.error, /page id/i, "要提示用 page id 找切图（scope 语义坑）");
});

test("exportIds 过滤：只下载指定项", async () => {
  resetAll();
  integrationFixtures.exportAssetList = listAfterRender();
  integrationFixtures.exportAssetDownload = {
    data: PNG_1x1,
    contentType: "image/png",
    contentDisposition: 'attachment; filename="x.png"',
  };

  const tool = new DownloadExportAssetsTool();
  await tool.execute({
    fileId: FILE_ID,
    layerId: LAYER_ID,
    exportIds: ["2:0"],
    outDir: "filtered",
  } as any);

  const dlCalls = integrationCalls.filter((c) => c.method === "downloadExportAsset");
  assert.equal(dlCalls.length, 1);
  assert.equal(dlCalls[0].exportId, "2:0");
});

test("exportIds 指向不存在的项时不下载任何文件", async () => {
  resetAll();
  integrationFixtures.exportAssetList = listAfterRender();

  const tool = new DownloadExportAssetsTool();
  const res = await tool.execute({
    fileId: FILE_ID,
    layerId: LAYER_ID,
    exportIds: ["999:999"],
  } as any);

  assert.equal(
    integrationCalls.filter((c) => c.method === "downloadExportAsset").length,
    0,
    "不存在的 exportId 不应触发下载",
  );
  // 没有候选也没有 skipped → 走 "no downloadable slice" 分支
  if (res.isError) {
    const out = parseToolText(res);
    assert.match(String(out.error ?? ""), /No downloadable slice/i);
  }
});

test("getExportList 工具转发元数据，不触发渲染与下载", async () => {
  resetAll();
  integrationFixtures.exportList = {
    fileId: FILE_ID,
    layerId: LAYER_ID,
    scope: "page",
    total: 1,
    exports: [
      {
        id: "2:0",
        layerId: "1:3",
        layerName: "矩形 1",
        format: "PNG",
        targetWidth: 207,
        targetHeight: 278,
      },
    ],
    skipped: { missingLayer: 0, removedLayer: 0 },
  };

  const tool = new GetExportListTool();
  const res = await tool.execute({ fileId: FILE_ID, layerId: LAYER_ID } as any);

  assert.equal(res.isError, undefined);
  const out = parseToolText(res);
  assert.equal(out.total, 1);
  assert.equal(out.scope, "page");
  assert.equal(out.exports[0].layerId, "1:3");
  // 元数据接口是纯读，绝不能顺带触发渲染/下载（否则成本陡增）
  assert.equal(integrationCalls.filter((c) => c.method === "renderExportAssets").length, 0);
  assert.equal(integrationCalls.filter((c) => c.method === "downloadExportAsset").length, 0);
});
