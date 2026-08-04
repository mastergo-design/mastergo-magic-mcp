import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toolName,
  getToolPrefix,
  getNoPrefix,
  applyToolPrefix,
  setNoPrefix,
  resetNoPrefix,
} from "../src/utils/tool-prefix";
import { parseNoPrefix } from "../src/utils/args";

// ---- helpers ----

// Reset the cached no-prefix result AND the env var so each test starts clean.
const reset = () => {
  resetNoPrefix();
  delete process.env.MG_NO_PREFIX;
};

// parseNoPrefix() reads process.argv.slice(2), so drive it by setting argv.
const ORIG_ARGV = process.argv;
const withArgv = (...args: string[]) => {
  process.argv = ["node", "mastergo-magic-mcp", ...args];
};
const restoreArgv = () => {
  process.argv = ORIG_ARGV;
};

// ---- defaults (env unset) ----

test("default: toolName keeps mcp__ prefix", () => {
  reset();
  assert.equal(toolName("getDsl"), "mcp__getDsl");
  assert.equal(toolName("getDesignSections"), "mcp__getDesignSections");
});

test("default: getToolPrefix() === 'mcp__' and getNoPrefix() === false", () => {
  reset();
  assert.equal(getToolPrefix(), "mcp__");
  assert.equal(getNoPrefix(), false);
});

test("default: applyToolPrefix leaves text unchanged", () => {
  reset();
  const text = "call mcp__getDesignSections then mcp__applyDesign";
  assert.equal(applyToolPrefix(text), text);
});

// ---- setNoPrefix(true): tools register without mcp__ ----

test("no-prefix: toolName drops mcp__ prefix", () => {
  reset();
  setNoPrefix(true);
  assert.equal(toolName("getDsl"), "getDsl");
  assert.equal(toolName("getDesignSections"), "getDesignSections");
});

test("no-prefix: getToolPrefix() === '' and getNoPrefix() === true", () => {
  reset();
  setNoPrefix(true);
  assert.equal(getToolPrefix(), "");
  assert.equal(getNoPrefix(), true);
});

test("no-prefix: applyToolPrefix rewrites mcp__ references", () => {
  reset();
  setNoPrefix(true);
  assert.equal(
    applyToolPrefix("call mcp__getDesignSections then mcp__applyDesign"),
    "call getDesignSections then applyDesign"
  );
});

test("no-prefix: applyToolPrefix rewrites a multi-line rules block", () => {
  reset();
  setNoPrefix(true);
  const rules = [
    "Use mcp__getDsl to fetch DSL.",
    "Then call mcp__applyDesign as the final step.",
    "Do not call mcp__getDsl twice.",
  ];
  assert.deepEqual(applyToolPrefix(rules.join("\n")).split("\n"), [
    "Use getDsl to fetch DSL.",
    "Then call applyDesign as the final step.",
    "Do not call getDsl twice.",
  ]);
});

// ---- setNoPrefix(false): explicit disable ----

test("no-prefix=false: toolName keeps mcp__ prefix even when env says no-prefix", () => {
  reset();
  process.env.MG_NO_PREFIX = "1";
  setNoPrefix(false);
  assert.equal(toolName("getDsl"), "mcp__getDsl");
  assert.equal(applyToolPrefix("mcp__getDsl"), "mcp__getDsl");
});

// ---- resetNoPrefix(): back to env-based reading ----

test("resetNoPrefix: after reset, env var controls the result", () => {
  reset();
  setNoPrefix(true);
  assert.equal(toolName("getDsl"), "getDsl");

  // Delete env to simulate a fresh process with no MG_NO_PREFIX: reset should
  // restore the default prefixed names even though setNoPrefix(true) ran earlier.
  resetNoPrefix();
  delete process.env.MG_NO_PREFIX;
  assert.equal(toolName("getDsl"), "mcp__getDsl");
});

test("resetNoPrefix: re-reads MG_NO_PREFIX after setNoPrefix override", () => {
  reset();
  setNoPrefix(true);
  process.env.MG_NO_PREFIX = "0";
  resetNoPrefix();
  assert.equal(getNoPrefix(), false);
  assert.equal(toolName("getDsl"), "mcp__getDsl");
});

// ---- env var MG_NO_PREFIX ----

test("env: MG_NO_PREFIX=1 enables no-prefix mode", () => {
  reset();
  process.env.MG_NO_PREFIX = "1";
  assert.equal(getNoPrefix(), true);
  assert.equal(getToolPrefix(), "");
  assert.equal(toolName("applyDesign"), "applyDesign");
});

test("env: MG_NO_PREFIX=true/yes also enable no-prefix mode", () => {
  reset();
  process.env.MG_NO_PREFIX = "true";
  assert.equal(getNoPrefix(), true);
  process.env.MG_NO_PREFIX = "yes";
  assert.equal(getNoPrefix(), true);
});

test("env: MG_NO_PREFIX=0 / unset keeps default prefix", () => {
  reset();
  process.env.MG_NO_PREFIX = "0";
  assert.equal(getNoPrefix(), false);
  delete process.env.MG_NO_PREFIX;
  assert.equal(getNoPrefix(), false);
});

test("env: MG_NO_PREFIX values are case-insensitive", () => {
  reset();
  process.env.MG_NO_PREFIX = "TRUE";
  assert.equal(getNoPrefix(), true);
  reset();
  process.env.MG_NO_PREFIX = "True";
  assert.equal(getNoPrefix(), true);
  reset();
  process.env.MG_NO_PREFIX = "YES";
  assert.equal(getNoPrefix(), true);
  reset();
  process.env.MG_NO_PREFIX = "No";
  assert.equal(getNoPrefix(), false);
});

// ---- parseNoPrefix() from args ----

test("parseNoPrefix: --no-prefix flag returns true", () => {
  try {
    withArgv("--no-prefix");
    assert.equal(parseNoPrefix(), true);
  } finally {
    restoreArgv();
  }
});

test("parseNoPrefix: absent flag returns undefined (defer to env)", () => {
  try {
    withArgv("--debug", "--token", "x");
    assert.equal(parseNoPrefix(), undefined);
  } finally {
    restoreArgv();
  }
});

test("parseNoPrefix: --no-prefix mixed with other flags", () => {
  try {
    withArgv("--token", "test", "--no-prefix", "--debug");
    assert.equal(parseNoPrefix(), true);
  } finally {
    restoreArgv();
  }
});

test("parseNoPrefix: --no-prefix=false form is ignored (only exact flag counts)", () => {
  try {
    withArgv("--no-prefix=false");
    assert.equal(parseNoPrefix(), undefined);
  } finally {
    restoreArgv();
  }
});

// ---- integration path: main() sets setNoPrefix(parseNoPrefix()) ----

test("integration: MG_NO_PREFIX=1 + no --no-prefix keeps env-driven no-prefix", () => {
  reset();
  process.env.MG_NO_PREFIX = "1";
  try {
    withArgv("--token", "test"); // 无 --no-prefix → parseNoPrefix() 返回 undefined
    const noPrefix = parseNoPrefix();
    assert.equal(noPrefix, undefined);
    setNoPrefix(noPrefix); // main() 中无条件调用，但 undefined 不应覆盖 env
    assert.equal(getNoPrefix(), true);
    assert.equal(toolName("getDsl"), "getDsl");
    assert.equal(toolName("getDesignSections"), "getDesignSections");
  } finally {
    restoreArgv();
  }
});

test("integration: MG_NO_PREFIX unset + no --no-prefix keeps default prefix", () => {
  reset();
  try {
    withArgv("--token", "test");
    setNoPrefix(parseNoPrefix());
    assert.equal(getNoPrefix(), false);
    assert.equal(toolName("getDsl"), "mcp__getDsl");
  } finally {
    restoreArgv();
  }
});

test("integration: --no-prefix overrides MG_NO_PREFIX=0", () => {
  reset();
  process.env.MG_NO_PREFIX = "0";
  try {
    withArgv("--no-prefix");
    setNoPrefix(parseNoPrefix());
    assert.equal(getNoPrefix(), true);
    assert.equal(toolName("getDsl"), "getDsl");
  } finally {
    restoreArgv();
  }
});

test("setNoPrefix: does not mutate process.env.MG_NO_PREFIX", () => {
  reset();
  delete process.env.MG_NO_PREFIX;
  setNoPrefix(true);
  assert.equal(process.env.MG_NO_PREFIX, undefined);
  setNoPrefix(false);
  assert.equal(process.env.MG_NO_PREFIX, undefined);
});
