import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 必须在任何 applyDesign execute 之前设置（outDir 安全校验按此解析允许根）。
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mg-page-restore-it-"));
process.env.MG_OUTPUT_ROOT = outputRoot;

import { GetPageLayersTool } from "../src/tools/get-page-layers";
import { GetDesignSectionsTool } from "../src/tools/get-design-sections";
import { ApplyDesignTool } from "../src/tools/apply-design";
import { resetForTest } from "../src/utils/page-restore-tracker";
import { integrationFixtures, integrationCalls, resetIntegrationFixtures } from "./stubs/api-stub";

// 工具层集成测试：模拟 LLM 的完整调用序列，验证 pageRestore 编排注入在真实工具
// execute 路径上生效（tracker 单测只覆盖状态机本身，这里覆盖三工具的接线）。
//
// stub 面（test/build-integration.mjs 的 esbuild alias）：
//   zod / js-yaml / base-tool / api —— bundle 完全自包含，无 node_modules 依赖。

function outDir(name: string): string {
  const dir = path.join(outputRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parse(resp: { content: Array<{ type: string; text: string }> }): any {
  assert.equal(resp.content.length, 1);
  assert.equal(resp.content[0].type, "text");
  return JSON.parse(resp.content[0].text);
}

const THREE_LAYERS = {
  fileId: "123",
  pageLayerId: "M",
  pageName: "首页",
  totalLayers: 3,
  layers: [
    { id: "802:1", name: "导航栏", type: "FRAME", depth: 0, childrenCount: 0 },
    { id: "802:2", name: "侧边栏", type: "FRAME", depth: 0, childrenCount: 0 },
    { id: "802:3", name: "数据表格", type: "FRAME", depth: 0, childrenCount: 0 },
  ],
};

function setupHappyPathFixtures(): string {
  integrationFixtures.pageLayers = THREE_LAYERS;
  integrationFixtures.designSectionsList = {
    sections: [
      { id: "802:1:0", name: "头部", type: "FRAME", nodeCount: 10 },
      { id: "802:1:1", name: "内容", type: "FRAME", nodeCount: 20 },
    ],
    totalSections: 2,
    totalNodes: 30,
  };
  integrationFixtures.applyDesign = { patchedCode: "<html>final</html>", report: {} };
  return outDir("happy");
}

test("① 全流程：建计划 → 逐层 position → LAYER_DONE.next → COMPLETE", async () => {
  resetForTest();
  resetIntegrationFixtures();
  const dir = setupHappyPathFixtures();

  // Step 1: 枚举 → 建计划，指令指向首层
  const enumResp = parse(await new GetPageLayersTool().execute({ fileId: "123", layerId: "M" }));
  assert.equal(enumResp.pageRestore.firstLayerId, "802:1");
  assert.equal(enumResp.pageRestore.firstFileName, "导航栏-1.html");
  assert.ok(enumResp.nextAction.includes("layerId=802:1"));
  assert.ok(enumResp.nextAction.includes("3 layers"));

  // Step 2: 首层 section list → 注入整页位置
  const listResp = parse(await new GetDesignSectionsTool().execute({ fileId: "123", layerId: "802:1" }));
  assert.equal(listResp.pageRestore.position.includes("[1/3]"), true);
  assert.ok(listResp.nextAction); // 客户端 section 工作流指令仍在（两套编排共存）

  // Step 3: 首层 applyDesign → LAYER_DONE + next 指向第二层 + 文件落盘
  const file1 = path.join(dir, "nav.html");
  const applyResp1 = parse(await new ApplyDesignTool().execute({
    fileId: "123", layerId: "802:1", code: "<html>@@SVG:S0#0@@</html>",
    outDir: dir, outputFileName: "nav.html",
  }));
  assert.equal(applyResp1.pageRestore.status, "LAYER_DONE");
  assert.equal(applyResp1.pageRestore.nextLayerId, "802:2");
  assert.equal(applyResp1.pageRestore.nextFileName, "侧边栏-2.html");
  assert.ok(applyResp1.nextAction.includes("802:2"));
  assert.equal(fs.readFileSync(file1, "utf8"), "<html>final</html>");

  // Step 4/5: 第二层走完 → next 指向第三层
  await new GetDesignSectionsTool().execute({ fileId: "123", layerId: "802:2" });
  const applyResp2 = parse(await new ApplyDesignTool().execute({
    fileId: "123", layerId: "802:2", code: "<html>b</html>", outDir: dir, outputFileName: "sidebar.html",
  }));
  assert.equal(applyResp2.pageRestore.status, "LAYER_DONE");
  assert.equal(applyResp2.pageRestore.nextLayerId, "802:3");

  // Step 6: 第三层走完 → COMPLETE 汇总
  await new GetDesignSectionsTool().execute({ fileId: "123", layerId: "802:3" });
  const applyResp3 = parse(await new ApplyDesignTool().execute({
    fileId: "123", layerId: "802:3", code: "<html>c</html>", outDir: dir, outputFileName: "table.html",
  }));
  assert.equal(applyResp3.pageRestore.status, "COMPLETE");
  assert.ok(applyResp3.nextAction.includes("PAGE RESTORE COMPLETE"));
  assert.ok(applyResp3.nextAction.includes("3/3"));
});

test("② 10017 确定性失败：标记跳过、整页继续推进到 COMPLETE", async () => {
  resetForTest();
  resetIntegrationFixtures();
  const dir = outDir("oversized");
  integrationFixtures.pageLayers = {
    ...THREE_LAYERS,
    layers: THREE_LAYERS.layers.slice(0, 2),
    totalLayers: 2,
  };
  integrationFixtures.designSectionsList = { sections: [], totalSections: 0 };
  integrationFixtures.applyDesign = { patchedCode: "<html>ok</html>", report: {} };
  integrationFixtures.designSectionsError = {
    response: { status: 413, data: { code: "10017", message: "layer data exceeds the 20MB limit" } },
  };

  await new GetPageLayersTool().execute({ fileId: "123", layerId: "M" });

  // 第一层 list 命中 10017 → 跳层指令而非原始报错
  const skipped = parse(await new GetDesignSectionsTool().execute({ fileId: "123", layerId: "802:1" }));
  assert.equal(skipped.error, "LAYER_SKIPPED_IN_PAGE_RESTORE");
  assert.equal(skipped.pageRestore.status, "LAYER_FAILED_SKIPPED");
  assert.ok(skipped.pageRestore.instruction.includes("Do NOT retry"));

  // 第二层正常走完 → COMPLETE 汇总带 skipped 计数
  integrationFixtures.designSectionsError = undefined;
  await new GetDesignSectionsTool().execute({ fileId: "123", layerId: "802:2" });
  const done = parse(await new ApplyDesignTool().execute({
    fileId: "123", layerId: "802:2", code: "<html>x</html>", outDir: dir, outputFileName: "b.html",
  }));
  assert.equal(done.pageRestore.status, "COMPLETE");
  assert.ok(done.nextAction.includes("1 layer(s) skipped"));
});

test("③ 单图层还原不受编排影响：未建计划时无 pageRestore 注入", async () => {
  resetForTest();
  resetIntegrationFixtures();
  const dir = outDir("single");
  integrationFixtures.designSectionsList = { sections: [{ id: "1:1:0", name: "s", type: "FRAME", nodeCount: 1 }], totalSections: 1 };
  integrationFixtures.applyDesign = { patchedCode: "<html>single</html>", report: {} };

  const listResp = parse(await new GetDesignSectionsTool().execute({ fileId: "999", layerId: "1:1" }));
  assert.equal(listResp.pageRestore, undefined);

  const applyResp = parse(await new ApplyDesignTool().execute({
    fileId: "999", layerId: "1:1", code: "<html>s</html>", outDir: dir, outputFileName: "s.html",
  }));
  assert.equal(applyResp.pageRestore, undefined);
  assert.equal(applyResp.success, true);
  assert.equal(fs.readFileSync(path.join(dir, "s.html"), "utf8"), "<html>single</html>");
});

test("④ 断点续跑：重新枚举后已完成层不重置，next 直接落到未完成层", async () => {
  resetForTest();
  resetIntegrationFixtures();
  const dir = outDir("resume");
  integrationFixtures.pageLayers = THREE_LAYERS;
  integrationFixtures.designSectionsList = {
    sections: [{ id: "802:2:0", name: "内容", type: "FRAME", nodeCount: 8 }],
    totalSections: 1,
    totalNodes: 8,
  };
  integrationFixtures.applyDesign = { patchedCode: "<html>r</html>", report: {} };

  await new GetPageLayersTool().execute({ fileId: "123", layerId: "M" });
  await new ApplyDesignTool().execute({
    fileId: "123", layerId: "802:1", code: "<html>a</html>", outDir: dir, outputFileName: "a.html",
  });

  // LLM 迷路后重新枚举（同 fileId+pageId）
  const again = parse(await new GetPageLayersTool().execute({ fileId: "123", layerId: "M" }));
  // 计划重建后首层仍是 802:1（枚举顺序），但下一次 applyDesign 完成层进度不回退——
  // 通过 getDesignSections 的 position 侧写：第二层应显示进度 1/3 done 已保留
  const listResp = parse(await new GetDesignSectionsTool().execute({ fileId: "123", layerId: "802:2" }));
  assert.equal(listResp.pageRestore.position.includes("[2/3]"), true);
  assert.equal(listResp.pageRestore.done, 1);
  void again; void dir;
});
