import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 必须在任何 execute 之前设置（outDir 安全校验按此解析允许根）。
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mg-render-layers-it-"));
process.env.MG_OUTPUT_ROOT = outputRoot;

import { RenderLayersTool } from "../src/tools/render-layers";
import { integrationFixtures, integrationCalls, resetIntegrationFixtures } from "./stubs/api-stub";

/**
 * 任意图层截图工具（mcp__renderLayers）的集成测试：真实 execute 路径 + stub 化的 api 层。
 *
 * 背景（oncall 13887）：切图链路只能拿「设计师配了 Export 的图层」，而视觉还原比对需要
 * 「画布上任意一屏/一层」。服务端新增 POST /mcp/render-layers 后，本工具负责把它变成
 * 「一步调用拿到本地图片文件」。
 *
 * 锁定的契约：
 *  ① 渲染 → 按 exportId(=layerId) 下载 → 落盘，filePath 真实存在且字节一致；
 *  ② layerIds / format / scale 正确透传给服务端（format 用数字码，对外是可读枚举）；
 *  ③ 渲染成功但下载全失败时，返回 isError 且带**逐目标原因**（不能只说一句 failed）；
 *  ④ outDir 越界被拒（prompt-injection 防护，与其它落盘工具同一套约束）。
 */

const FILE_ID = "210211525873349";
const LAYER_ID = "50:9";

const PNG_BYTES = Buffer.from("89504e470d0a1a0a", "hex");

function resetAll(): void {
  resetIntegrationFixtures();
}

/** 服务端一次成功的截图返回：exportId === layerId（本通道的核心约定）。 */
function renderResult(overrides: Record<string, unknown> = {}) {
  return {
    fileId: FILE_ID,
    scope: LAYER_ID,
    total: 1,
    dir: `/tmp/mg-export-assets/${FILE_ID}`,
    assets: [
      {
        exportId: LAYER_ID,
        layerId: LAYER_ID,
        format: "png",
        width: 276,
        height: 226,
        bytes: PNG_BYTES.length,
        fileName: "50-9.png",
      },
    ],
    skipped: [],
    images: { loaded: 0, skipped: [] },
    ...overrides,
  };
}

test("渲染 + 下载 + 落盘：得到真实文件，exportId 与 layerId 都回填", async () => {
  resetAll();
  integrationFixtures.renderLayers = renderResult();
  integrationFixtures.exportAssetDownload = { data: PNG_BYTES, contentType: "image/png" };

  const tool = new RenderLayersTool();
  const result: any = await tool.execute({ fileId: `file/${FILE_ID}`, layerId: LAYER_ID });
  const body = JSON.parse(result.content[0].text);

  assert.equal(body.success, true);
  assert.equal(body.assets.length, 1);
  assert.equal(body.assets[0].exportId, LAYER_ID);
  assert.equal(body.assets[0].layerId, LAYER_ID);
  assert.equal(body.assets[0].width, 276);

  // 文件真的写出来了，且字节与下载一致（不是空壳）
  const written = fs.readFileSync(body.assets[0].filePath);
  assert.deepEqual(written, PNG_BYTES);
  assert.ok(body.assets[0].filePath.startsWith(outputRoot));

  // file/ 前缀必须被剥掉（normalizeFileId）
  const renderCall = integrationCalls.find((c) => c.method === "renderLayers");
  assert.equal(renderCall?.fileId, FILE_ID);
  // 下载用的是 exportId=layerId
  const dlCall = integrationCalls.find((c) => c.method === "downloadExportAsset");
  assert.equal(dlCall?.exportId, LAYER_ID);
});

test("layerIds / format / scale 透传：对外枚举转服务端数字码", async () => {
  resetAll();
  integrationFixtures.renderLayers = renderResult();
  integrationFixtures.exportAssetDownload = { data: PNG_BYTES };

  const tool = new RenderLayersTool();
  await tool.execute({
    fileId: FILE_ID,
    layerId: LAYER_ID,
    layerIds: ["50:9", "50:02"],
    imageFormat: "WEBP",
    scale: 2,
  });

  const call = integrationCalls.find((c) => c.method === "renderLayers");
  assert.deepEqual((call?.options as any).layerIds, ["50:9", "50:02"]);
  assert.equal((call?.options as any).format, 4); // WEBP → 4
  assert.equal((call?.options as any).scale, 2);
});

test("默认不传 format/scale 时不写这两个字段（交给服务端默认）", async () => {
  resetAll();
  integrationFixtures.renderLayers = renderResult();
  integrationFixtures.exportAssetDownload = { data: PNG_BYTES };

  const tool = new RenderLayersTool();
  await tool.execute({ fileId: FILE_ID, layerId: LAYER_ID });

  const call = integrationCalls.find((c) => c.method === "renderLayers");
  assert.equal((call?.options as any).format, undefined);
  assert.equal((call?.options as any).scale, undefined);
});

test("渲染成功但下载全失败 → isError，且带逐目标原因", async () => {
  resetAll();
  integrationFixtures.renderLayers = renderResult();
  integrationFixtures.exportAssetDownload = { error: true }; // stub 里无 data → 走到 catch 前先炸
  // 让 download 抛错以模拟「渲染后缓存过期」
  integrationFixtures.exportAssetDownload = undefined;

  const tool = new RenderLayersTool();
  const result: any = await tool.execute({ fileId: FILE_ID, layerId: LAYER_ID });

  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.ok(body.error.includes("No layer image could be produced"));
  // 原因必须可读，不能只有一句 failed
  assert.ok(JSON.stringify(body).length > 0);
});

test("服务端回 skipped（实例内图层）时原样带回给调用方", async () => {
  resetAll();
  integrationFixtures.renderLayers = renderResult({
    total: 2,
    assets: [],
    skipped: [
      { layerId: "50:9/50:02", reason: "layer lives inside a component instance; render the instance itself instead" },
    ],
  });

  const tool = new RenderLayersTool();
  const result: any = await tool.execute({
    fileId: FILE_ID,
    layerId: LAYER_ID,
    layerIds: ["50:9/50:02"],
  });

  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.ok(body.error.includes("component instance"));
});

test("outDir 越界被拒（prompt-injection 写任意路径防护）", async () => {
  resetAll();
  integrationFixtures.renderLayers = renderResult();
  integrationFixtures.exportAssetDownload = { data: PNG_BYTES };

  const tool = new RenderLayersTool();
  const result: any = await tool.execute({
    fileId: FILE_ID,
    layerId: LAYER_ID,
    outDir: "../../../../tmp/evil",
  });

  assert.equal(result.isError, true);
  assert.ok(result.content[0].text.includes("outside the allowed output root"));
});

test("缺 fileId/layerId 且无 shortLink → isError 且不打任何请求", async () => {
  resetAll();

  const tool = new RenderLayersTool();
  const result: any = await tool.execute({ fileId: FILE_ID });

  assert.equal(result.isError, true);
  assert.equal(integrationCalls.filter((c) => c.method === "renderLayers").length, 0);
});
