import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractComponentDocumentLinks,
  mergeWithLocalComponentLinks,
} from "../src/utils/api";

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

// ---- mergeWithLocalComponentLinks（旧服务端兼容）----
//
// getDesignSections 的 section DSL 响应里，顶层 componentDocumentLinks 由【服务端】注入。
// 私有化部署按月发版，旧服务端仍只聚合 componentSetDocumentLink[0]。而响应自带完整
// dsl.nodes，客户端本地重算后与服务端结果取并集即可兜底 —— 无需版本检测，且对新服务端幂等。

test("merge: new server (same result) is idempotent", () => {
  const dsl = {
    nodes: [
      {
        componentInfo: {
          componentSetDocumentLink: ["https://a.example/set"],
          documentLink: ["https://a.example/comp"],
        },
      },
    ],
  };
  const server = extractComponentDocumentLinks(dsl); // 新服务端 == 本地结果
  assert.deepEqual(mergeWithLocalComponentLinks(server, dsl), server);
});

test("merge: old server (set-only, first entry) gets complemented", () => {
  const dsl = {
    nodes: [
      {
        componentInfo: {
          componentSetDocumentLink: [
            "https://a.example/set-1",
            "https://a.example/set-2",
          ],
          documentLink: ["https://a.example/comp"],
        },
      },
    ],
  };
  // 旧服务端只会聚合出 componentSetDocumentLink[0]
  const merged = mergeWithLocalComponentLinks(["https://a.example/set-1"], dsl);
  assert.deepEqual(merged, [
    "https://a.example/set-1", // 服务端原有顺序保持在前
    "https://a.example/set-2", // 本地补回数组后续条目
    "https://a.example/comp", // 本地补回单组件级
  ]);
});

test("merge: server links absent/undefined → falls back to purely local result", () => {
  const dsl = {
    nodes: [{ componentInfo: { documentLink: ["https://a.example/comp"] } }],
  };
  assert.deepEqual(mergeWithLocalComponentLinks(undefined, dsl), [
    "https://a.example/comp",
  ]);
  assert.deepEqual(mergeWithLocalComponentLinks(null, dsl), [
    "https://a.example/comp",
  ]);
  assert.deepEqual(mergeWithLocalComponentLinks("not-an-array", dsl), [
    "https://a.example/comp",
  ]);
});

test("merge: preserves server order and dedupes overlap", () => {
  const dsl = {
    nodes: [
      {
        componentInfo: {
          componentSetDocumentLink: ["https://b.example/set"],
          documentLink: ["https://a.example/comp"],
        },
      },
    ],
  };
  const merged = mergeWithLocalComponentLinks(
    ["https://b.example/set", "https://z.example/only-server"],
    dsl,
  );
  assert.deepEqual(merged, [
    "https://b.example/set",
    "https://z.example/only-server", // 服务端独有（本地 dsl 无该节点）也保留
    "https://a.example/comp",
  ]);
});

test("merge: does not mutate inputs", () => {
  const server = ["https://a.example/set"];
  const dsl = {
    nodes: [{ componentInfo: { documentLink: ["https://a.example/comp"] } }],
  };
  const serverCopy = [...server];
  const dslCopy = JSON.stringify(dsl);
  mergeWithLocalComponentLinks(server, dsl);
  assert.deepEqual(server, serverCopy); // 服务端数组未被追加
  assert.equal(JSON.stringify(dsl), dslCopy);
});

test("merge: no dsl and no server links → empty array", () => {
  assert.deepEqual(mergeWithLocalComponentLinks(undefined, undefined), []);
  assert.deepEqual(mergeWithLocalComponentLinks([], {}), []);
});

test("merge: filters non-string / empty entries from server links", () => {
  const merged = mergeWithLocalComponentLinks(
    ["https://a.example/set", "", null, undefined, 42],
    undefined,
  );
  assert.deepEqual(merged, ["https://a.example/set"]);
});
