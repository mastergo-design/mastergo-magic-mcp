import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  formatOutput,
  normalizeFormat,
  FORMAT_VALUES,
} from "../src/utils/format";

// ---- helpers ----
const isJson = (s: string) => {
  const t = s.trimStart();
  return t.startsWith("{") || t.startsWith("[");
};
const roundTripYaml = (data: unknown) =>
  yaml.load(formatOutput(data, "yaml")) as unknown;

// ---- fixtures matching the real server response shapes ----
const rawDsl = {
  styles: { "paint_1:1": { value: ["#FFFFFF"] } },
  nodes: [
    {
      type: "FRAME",
      id: "1:2",
      name: "Root",
      layoutStyle: { width: 10, height: 10, relativeX: 0, relativeY: 0 },
    },
  ],
};
const sectionDsl = {
  sectionIndex: 0,
  section: { id: "1:2", name: "Hero", type: "FRAME" },
  dsl: {
    styles: {},
    nodes: [
      {
        type: "TEXT",
        id: "1:3",
        name: "Title",
        layoutStyle: { width: 80, height: 24, relativeX: 0, relativeY: 0 },
        text: [{ text: "Hi", font: "f:1" }],
      },
    ],
  },
};
const getDslPayload = { dsl: rawDsl, componentDocumentLinks: [], rules: ["r1"] };
const sectionList = {
  sections: [
    {
      id: "1:2",
      name: "Hero",
      type: "FRAME",
      nodeCount: 5,
      x: 0,
      y: 0,
      width: 1040,
      height: 800,
    },
  ],
  totalSections: 1,
  totalNodes: 5,
  rootContainer: { width: 1040 },
};
const svgsPayload = { svgs: { "S0:Icon|1:3": "<svg/>" }, nodeCount: 1 };
const svgsEmpty = { message: "No cached SVG data found.", svgs: {}, nodeCount: 0 };
const textsPayload = { texts: { "T0|1:3": "已启用" }, textCount: 1 };
const textsEmpty = { message: "No cached text data found.", texts: {}, textCount: 0 };
const extractSvgPayload = {
  count: 2,
  svgs: [
    { name: "a", id: "1:2", svg: "<svg/>" },
    { name: "b", id: "1:3", svg: "<svg>\n  <path/>\n</svg>" },
  ],
};
const extractSvgEmpty = { count: 0, svgs: [] };
const metaPayload = { result: { site: "x" }, rules: "# Rules\n- one" };

const allShapes = [
  sectionDsl,
  rawDsl,
  getDslPayload,
  sectionList,
  svgsPayload,
  textsPayload,
  extractSvgPayload,
  metaPayload,
];

// ---- 1. format dispatch per shape ----

test("json: every shape returns JSON byte-identical to JSON.stringify", () => {
  for (const data of allShapes) {
    assert.equal(formatOutput(data, "json"), JSON.stringify(data));
  }
});

test("yaml: round-trips losslessly for every serializable shape", () => {
  for (const data of allShapes) {
    assert.deepEqual(roundTripYaml(data), data);
  }
});

test("tree: dispatches every shape except getMeta (markdown rules fall back to JSON)", () => {
  for (const data of [
    sectionDsl,
    rawDsl,
    getDslPayload,
    sectionList,
    svgsPayload,
    textsPayload,
    extractSvgPayload,
  ]) {
    const out = formatOutput(data, "tree");
    assert.ok(!isJson(out), `expected tree, got JSON: ${out.slice(0, 80)}`);
  }
  // getMeta carries markdown `rules` — tree must fall back to JSON, not mangle it.
  assert.equal(formatOutput(metaPayload, "tree"), JSON.stringify(metaPayload));
});

// ---- 2. specific tree renderings ----

test("tree/section DSL: globalVars + positional node header", () => {
  const out = formatOutput(sectionDsl, "tree");
  assert.match(out, /globalVars:/);
  assert.match(out, /TEXT 1:3 "Title" 80x24 @0,0/);
});

test("tree/getDesignSvgs: block + inline value; empty -> 'svgs: {}'", () => {
  assert.match(formatOutput(svgsPayload, "tree"), /svgs:\n {2}S0:Icon\|1:3: <svg\/>/);
  assert.match(formatOutput(svgsEmpty, "tree"), /svgs: \{\}/);
});

test("tree/getDesignTexts: block + verbatim CJK; empty -> 'texts: {}'", () => {
  assert.match(formatOutput(textsPayload, "tree"), /texts:\n {2}T0\|1:3: 已启用/);
  assert.match(formatOutput(textsEmpty, "tree"), /texts: \{\}/);
});

test("tree/extractSvg: [i] entries, multi-line svg indented; empty -> 'svgs: []'", () => {
  const out = formatOutput(extractSvgPayload, "tree");
  assert.match(out, /\[0\] "a" \(1:2\)/);
  assert.match(out, /\[1\] "b" \(1:3\)/);
  assert.match(out, / {4}<svg>/); // multi-line svg value indented beneath the entry
  assert.match(out, / {6}<path\/>/);
  assert.match(formatOutput(extractSvgEmpty, "tree"), /svgs: \[\]/);
});

test("tree/section list: [i] entry with page-absolute bbox", () => {
  assert.match(
    formatOutput(sectionList, "tree"),
    /\[0\] FRAME 1:2 "Hero" 1040x800 @0,0 nodeCount=5/
  );
});

// ---- 3. resolution / fallbacks ----

test("normalizeFormat: accepts valid, rejects invalid/unset", () => {
  assert.equal(normalizeFormat("yaml"), "yaml");
  assert.equal(normalizeFormat("tree"), "tree");
  assert.equal(normalizeFormat("bogus"), null);
  assert.equal(normalizeFormat(undefined), null);
  assert.equal(normalizeFormat(""), null);
});

test("resolveFormat precedence: explicit param > DEFAULT_FORMAT env > json", () => {
  process.env.DEFAULT_FORMAT = "yaml";
  try {
    assert.match(formatOutput(rawDsl, "tree"), /globalVars:/); // explicit tree wins
    assert.ok(formatOutput(rawDsl).startsWith("styles:")); // env yaml (rawDsl starts with styles:)
    assert.equal(formatOutput(rawDsl, "json"), JSON.stringify(rawDsl)); // explicit json wins
  } finally {
    delete process.env.DEFAULT_FORMAT;
  }
});

test("resolveFormat: bogus DEFAULT_FORMAT env -> json", () => {
  process.env.DEFAULT_FORMAT = "xml";
  try {
    assert.equal(formatOutput(rawDsl), JSON.stringify(rawDsl));
  } finally {
    delete process.env.DEFAULT_FORMAT;
  }
});

test("resolveFormat: no explicit, no env -> json", () => {
  delete process.env.DEFAULT_FORMAT;
  assert.equal(formatOutput(rawDsl), JSON.stringify(rawDsl));
});

test("invalid format arg -> json", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(formatOutput(rawDsl, "xml" as any), JSON.stringify(rawDsl));
});

// ---- 4. yaml error fallback: pure JSON + warn, never the comment hybrid ----

test("yaml fallback: serialization failure returns pure JSON (no '#' prefix) and warns", () => {
  // Function value: js-yaml.dump throws, JSON.stringify omits it -> {"b":2}
  const tricky = { a: (() => 1) as unknown as number, b: 2 };
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => warned.push(m);
  try {
    const out = formatOutput(tricky, "yaml");
    assert.equal(out, JSON.stringify(tricky));
    assert.ok(!out.startsWith("#"), "must not return the old comment+JSON hybrid");
    assert.equal(warned.length, 1);
    assert.match(warned[0], /yaml serialization failed/);
  } finally {
    console.warn = orig;
  }
});

// ---- 5. sanity ----

test("FORMAT_VALUES is exactly json/yaml/tree", () => {
  assert.deepEqual([...FORMAT_VALUES], ["json", "yaml", "tree"]);
});
