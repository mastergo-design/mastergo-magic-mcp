import { test } from "node:test";
import assert from "node:assert/strict";
import { extractComponentDocumentLinks } from "../src/utils/api";

// ---- extractComponentDocumentLinks（需求 13982）----
//
// 旧实现只收 componentSetDocumentLink[0]（组件集级第一条），两个缺口：
// ① 单组件级 documentLink 完全不进顶层聚合——文档只配在组件上时
//    componentDocumentLinks 为空，LLM 只看顶层就漏抓；
// ② documentationLinks 本是数组，只取 [0] 丢其余条目。
//
// 新实现两级都收、逐条收入、Set 去重，与 frontend-mcp-server
// utils/component-links.ts 逻辑对齐（服务端与 npm 包两侧一致）。

test("collects component-set level links (backward compatible)", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      {
        componentInfo: { componentSetDocumentLink: ["https://a.example/set"] },
      },
    ],
  });
  assert.deepEqual(links, ["https://a.example/set"]);
});

test("collects single-component level documentLink (core gap fix)", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      { componentInfo: { documentLink: ["https://a.example/comp"] } },
    ],
  });
  assert.deepEqual(links, ["https://a.example/comp"]);
});

test("collects both levels on the same node", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      {
        componentInfo: {
          documentLink: ["https://a.example/comp"],
          componentSetDocumentLink: ["https://a.example/set"],
        },
      },
    ],
  });
  assert.equal(links.length, 2);
  assert.ok(links.includes("https://a.example/comp"));
  assert.ok(links.includes("https://a.example/set"));
});

test("collects ALL entries from link arrays (not just [0])", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      {
        componentInfo: {
          componentSetDocumentLink: [
            "https://a.example/set-1",
            "https://a.example/set-2",
          ],
          documentLink: [
            "https://a.example/comp-1",
            "https://a.example/comp-2",
          ],
        },
      },
    ],
  });
  assert.equal(links.length, 4);
  assert.ok(links.includes("https://a.example/set-2"));
  assert.ok(links.includes("https://a.example/comp-2"));
});

test("dedupes across nodes and levels", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      {
        componentInfo: {
          componentSetDocumentLink: ["https://a.example/set"],
        },
        children: [
          {
            componentInfo: {
              componentSetDocumentLink: ["https://a.example/set"],
            },
          },
        ],
      },
      { componentInfo: { documentLink: ["https://a.example/set"] } },
    ],
  });
  assert.deepEqual(links, ["https://a.example/set"]);
});

test("traverses nested children recursively", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      {
        children: [
          {
            children: [
              {
                componentInfo: {
                  documentLink: ["https://deep.example/comp"],
                },
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(links, ["https://deep.example/comp"]);
});

test("skips empty / falsy links and missing componentInfo", () => {
  const links = extractComponentDocumentLinks({
    nodes: [
      { children: [{ componentInfo: {} }] },
      {
        componentInfo: {
          documentLink: [],
          componentSetDocumentLink: [],
        },
      },
      { componentInfo: { documentLink: [""] } },
      { name: "plain frame, no componentInfo" },
    ],
  });
  assert.deepEqual(links, []);
});

test("handles missing nodes / empty dsl", () => {
  assert.deepEqual(extractComponentDocumentLinks({}), []);
  assert.deepEqual(extractComponentDocumentLinks({ nodes: [] }), []);
});
