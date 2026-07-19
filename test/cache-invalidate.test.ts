import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCacheKey } from "../src/utils/api";

// matchCacheKey：判断 DSL 响应缓存 key 是否匹配给定的 fileId（和可选 layerId）。
//
// 回归背景（PR #112）：原 invalidateDslResponseCache 用 String.includes 做模糊匹配，
// 当一个 fileId 是另一个的子串时会误删——例如 fileId=123 会误命中含 1234 的 key，
// fileId=abc 会误命中含 abcdef 的 key。applyDesign 成功后调本函数清理对应设计稿缓存，
// 误删会把不相关设计稿的缓存也清掉，导致下次请求 miss 重新打 HTTP + Server 计算。
//
// 修复后改为按 `:` 分段精确比对。这些用例锁定以下不变量：
// ① fileId 段精确匹配；② 子串 fileId 不误命中；③ layerId 可选且精确；
// ④ 不带 extra 和带 extra 的 key 都能匹配；⑤ 格式异常的 key 安全跳过。

test("matchCacheKey: fileId 精确匹配（无 extra）", () => {
  assert.equal(matchCacheKey("sections:123:456:list", "123"), true);
  assert.equal(matchCacheKey("sections:123:456", "123"), true);
});

test("matchCacheKey: 子串 fileId 不误命中（核心回归点）", () => {
  // 1234 含子串 123，但 fileId 段必须整体等于 123 才匹配
  assert.equal(matchCacheKey("sections:1234:456:list", "123"), false);
  assert.equal(matchCacheKey("sections:12345:456", "123"), false);
  // 反向：传入 1234 不应匹配 fileId=123 的 key
  assert.equal(matchCacheKey("sections:123:456", "1234"), false);
});

test("matchCacheKey: 不同 method 的同 fileId 都匹配", () => {
  // meta / dsl / sections 三种 method 共享同一 fileId 应都能清理
  assert.equal(matchCacheKey("meta:123:456", "123"), true);
  assert.equal(matchCacheKey("dsl:123:456:src1", "123"), true);
  assert.equal(matchCacheKey("sections:123:456:0", "123"), true);
});

test("matchCacheKey: layerId 可选 —— 不传时只比 fileId", () => {
  assert.equal(matchCacheKey("sections:123:456", "123"), true);
  assert.equal(matchCacheKey("sections:123:789", "123"), true);
});

test("matchCacheKey: layerId 精确匹配 —— 传入时必须等于 key 中的 layerId 段", () => {
  assert.equal(matchCacheKey("sections:123:456", "123", "456"), true);
  assert.equal(matchCacheKey("sections:123:456", "123", "789"), false);
  // layerId 子串同样不应误命中
  assert.equal(matchCacheKey("sections:123:4567", "123", "456"), false);
});

test("matchCacheKey: 带 extra 段的 key 仍能匹配（extra 被忽略）", () => {
  // dslCacheKey 会在有 sourceLayerId 或 sectionIndex 时追加 extra 段
  assert.equal(matchCacheKey("sections:123:456:0", "123"), true);
  assert.equal(matchCacheKey("sections:123:456:5", "123", "456"), true);
  assert.equal(matchCacheKey("dsl:123:456:sourceLayer1", "123"), true);
});

test("matchCacheKey: 格式异常的 key 安全返回 false（不抛错）", () => {
  // 少于 3 段的异常 key，不应抛错
  assert.equal(matchCacheKey("malformed", "123"), false);
  assert.equal(matchCacheKey("a:b", "123"), false);
  assert.equal(matchCacheKey("", "123"), false);
});

test("matchCacheKey: layerId 含冒号等特殊字符的边界场景", () => {
  // layerId 通常不含冒号（否则会破坏 key 格式），但若真的含冒号，
  // split 会让 extra 段向后挪，layerId 段只取第一段——此处锁定当前行为：
  // 段切分是机械的，调用方需保证 fileId/layerId 不含冒号。
  // 正常情况（layerId 不含冒号）：
  assert.equal(matchCacheKey("sections:file-1:layer-2:0", "file-1", "layer-2"), true);
});
