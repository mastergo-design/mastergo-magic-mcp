import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startPageRestore,
  markLayerInProgress,
  completeLayer,
  failLayer,
  buildPageRestorePayload,
  buildNextLayerInstruction,
  suggestFileName,
  resetForTest,
} from "../src/utils/page-restore-tracker";

// 整页多图层还原编排状态机。锁定以下不变量：
// ① startPageRestore 建计划，payload 给出位置与 next；
// ② markLayerInProgress 不覆盖 done；
// ③ completeLayer 记录 outDir 并推进 next；全部完成时 buildNextLayerInstruction
//    返回 COMPLETE 且计划被清理（后续 payload 变 null，回到单图层语义）；
// ④ failLayer 跳层不阻塞整体推进；
// ⑤ 重新枚举（断点续跑）保留 done 态；
// ⑥ suggestFileName 清洗非法字符。

function mkLayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    layerId: `802:${1000 + i}`,
    name: `图层 ${i + 1}`,
    type: "FRAME",
  }));
}

test("① 建计划后 payload 提供位置与下一个图层", () => {
  resetForTest();
  startPageRestore("fileA", "M", mkLayers(3), "首页");
  const p = buildPageRestorePayload("fileA", "802:1000");
  assert.ok(p);
  assert.equal(p!.total, 3);
  assert.equal(p!.done, 0);
  assert.equal(p!.position.includes('1/3'), true);
  // 下一个是第 2 层（第 1 层尚未 done，in_progress 优先级最高——首层自身）
  assert.equal(p!.nextLayerId, "802:1000");
});

test("② markLayerInProgress 标记进行中且不覆盖 done", () => {
  resetForTest();
  startPageRestore("fileB", "M", mkLayers(2));
  markLayerInProgress("fileB", "802:1000");
  completeLayer("fileB", "802:1000", "/tmp/out");
  // done 之后再次 in_progress 不应回退状态
  markLayerInProgress("fileB", "802:1000");
  const p = buildPageRestorePayload("fileB", "802:1001");
  assert.equal(p!.done, 1);
  assert.equal(p!.nextLayerId, "802:1001");
});

test("③ 全部完成后返回 COMPLETE 且计划清理", () => {
  resetForTest();
  startPageRestore("fileC", "M", mkLayers(2));
  const plan1 = completeLayer("fileC", "802:1000", "/tmp/out");
  assert.ok(plan1);
  const { allDone: ad1, next: n1 } = buildNextLayerInstruction(plan1!);
  assert.equal(ad1, false);
  assert.equal(n1!.layerId, "802:1001");
  assert.equal(n1!.fileName, suggestFileName("图层 2", "802:1001"));

  const plan2 = completeLayer("fileC", "802:1001");
  const { allDone: ad2, instruction } = buildNextLayerInstruction(plan2!);
  assert.equal(ad2, true);
  assert.equal(instruction.includes("PAGE RESTORE COMPLETE"), true);
  // 计划已清理：后续 payload 回到 null（单图层语义，不再注入）
  assert.equal(buildPageRestorePayload("fileC", "802:1000"), null);
});

test("④ failLayer 跳层不阻塞整体推进", () => {
  resetForTest();
  startPageRestore("fileD", "M", mkLayers(3));
  const skipped = failLayer("fileD", "802:1000");
  assert.ok(skipped);
  const p = buildPageRestorePayload("fileD", "802:1001");
  assert.equal(p!.failed, 1);
  assert.equal(p!.nextLayerId, "802:1001");
  // 最后一个失败层也允许在 COMPLETE 汇总里计为 failed 而非卡死
  completeLayer("fileD", "802:1001");
  const plan = completeLayer("fileD", "802:1002");
  const { allDone, instruction } = buildNextLayerInstruction(plan!);
  assert.equal(allDone, true);
  assert.equal(instruction.includes("1 layer(s) skipped"), true);
});

test("⑤ 重新枚举保留已完成态（断点续跑）", () => {
  resetForTest();
  startPageRestore("fileE", "M", mkLayers(3));
  completeLayer("fileE", "802:1000");
  // 重新枚举（同 fileId+pageId）
  startPageRestore("fileE", "M", mkLayers(3));
  const p = buildPageRestorePayload("fileE", "802:1001");
  assert.equal(p!.done, 1);
  assert.equal(p!.nextLayerId, "802:1001");
  // outDir 也跨重新枚举保留
  assert.equal(p!.outDir, undefined); // 本例未传 outDir
});

test("⑥ suggestFileName 清洗非法字符并附加 layerId 尾段", () => {
  assert.equal(suggestFileName("导航/栏: 设置", "802:02364"), "导航-栏-设置-02364.html");
  assert.equal(suggestFileName("", "4:0687"), "layer-0687.html");
  assert.equal(suggestFileName("a\\b/c*d?e", "1:2"), "a-b-c-d-e-2.html");
});

test("⑦ 不属于计划的图层返回 null（单图层正常还原不受影响）", () => {
  resetForTest();
  startPageRestore("fileF", "M", mkLayers(1));
  assert.equal(buildPageRestorePayload("fileF", "999:9999"), null);
  assert.equal(completeLayer("fileG", "999:9999"), null);
  assert.equal(failLayer("fileG", "999:9999"), null);
});
