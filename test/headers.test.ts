import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHeaders,
  parseEnvHeaders,
  getEffectiveHeaders,
  maskSensitiveHeaders,
  resetEffectiveHeadersCache,
} from "../src/utils/args";

// ---- helpers ----

// parseHeaders() reads process.argv.slice(2), so drive it by setting argv.
const ORIG_ARGV = process.argv;
const withArgv = (...args: string[]) => {
  process.argv = ["node", "mastergo-magic-mcp", ...args];
};
const restoreArgv = () => {
  process.argv = ORIG_ARGV;
};

// Capture every console.warn call during a block.
const captureWarn = () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warns.push(args.join(" "));
  return {
    warns,
    restore: () => {
      console.warn = orig;
    },
  };
};

// ---- parseHeaders: valid inputs ----

test("parseHeaders: --header Key: Value", () => {
  try {
    withArgv("--header", "Key: Value");
    assert.deepEqual(parseHeaders(), { Key: "Value" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: --header=Key:Value (equals form)", () => {
  try {
    withArgv("--header=Key:Value");
    assert.deepEqual(parseHeaders(), { Key: "Value" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: --header=Key: Value (equals form, quoted at shell)", () => {
  try {
    withArgv("--header=Key: Value");
    assert.deepEqual(parseHeaders(), { Key: "Value" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: multiple --header flags", () => {
  try {
    withArgv("--header", "A: 1", "--header", "B: 2");
    assert.deepEqual(parseHeaders(), { A: "1", B: "2" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: value may contain colons (split on first ':')", () => {
  try {
    withArgv("--header", "K: a:b");
    assert.deepEqual(parseHeaders(), { K: "a:b" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: duplicate key — last value wins", () => {
  try {
    withArgv("--header", "K: 1", "--header", "K: 2");
    assert.deepEqual(parseHeaders(), { K: "2" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: valid inputs do not warn", () => {
  const cap = captureWarn();
  try {
    withArgv("--header", "A: 1", "--header=Key:Value", "--header", "K: a:b");
    parseHeaders();
    assert.equal(cap.warns.length, 0);
  } finally {
    restoreArgv();
    cap.restore();
  }
});

// ---- parseHeaders: invalid inputs (skip + warn) ----

test("parseHeaders: missing ':' separator -> skip + warn", () => {
  const cap = captureWarn();
  try {
    withArgv("--header", "novalue");
    assert.deepEqual(parseHeaders(), {});
    assert.equal(cap.warns.length, 1);
    assert.match(cap.warns[0], /missing ":" separator/);
  } finally {
    restoreArgv();
    cap.restore();
  }
});

test("parseHeaders: empty key (':value') -> skip + warn", () => {
  const cap = captureWarn();
  try {
    withArgv("--header", ":value");
    assert.deepEqual(parseHeaders(), {});
    assert.match(cap.warns[0], /empty header name/);
  } finally {
    restoreArgv();
    cap.restore();
  }
});

test("parseHeaders: trailing --header (no value) -> warn", () => {
  const cap = captureWarn();
  try {
    withArgv("--header");
    assert.deepEqual(parseHeaders(), {});
    assert.match(cap.warns[0], /missing value/);
  } finally {
    restoreArgv();
    cap.restore();
  }
});

test("parseHeaders: empty value ('key:') -> kept + warn", () => {
  const cap = captureWarn();
  try {
    withArgv("--header", "key:");
    assert.deepEqual(parseHeaders(), { key: "" });
    assert.match(cap.warns[0], /empty value/);
  } finally {
    restoreArgv();
    cap.restore();
  }
});

// ---- parseHeaders: don't swallow a following flag (review #3) ----

test("parseHeaders: --header followed by another flag -> warn, header skipped", () => {
  const cap = captureWarn();
  try {
    withArgv("--header", "--debug");
    assert.deepEqual(parseHeaders(), {});
    assert.ok(cap.warns.some((w) => /looks like a flag/.test(w)));
  } finally {
    restoreArgv();
    cap.restore();
  }
});

test("parseHeaders: following flag is not consumed — a later --header still parses", () => {
  const cap = captureWarn();
  try {
    withArgv("--header", "--debug", "--header", "A: 1");
    assert.deepEqual(parseHeaders(), { A: "1" });
    assert.ok(cap.warns.some((w) => /looks like a flag/.test(w)));
  } finally {
    restoreArgv();
    cap.restore();
  }
});

test("parseHeaders: --header --header 'X:1' -> second --header not eaten", () => {
  try {
    withArgv("--header", "--header", "X:1");
    assert.deepEqual(parseHeaders(), { X: "1" });
  } finally {
    restoreArgv();
  }
});

test("parseHeaders: sensitive raw input is redacted from warn (no credential echo)", () => {
  const cap = captureWarn();
  try {
    // Missing ":" separator — raw looks like a mistyped auth header whose value
    // is a real credential. It must be skipped AND never echoed to stderr.
    withArgv("--header", "Authorization Bearer supersecretvalue");
    assert.deepEqual(parseHeaders(), {});
    assert.ok(cap.warns.some((w) => /missing ":" separator/.test(w)));
    // The secret must never appear in any warn line, even truncated.
    assert.ok(cap.warns.every((w) => !w.includes("supersecretvalue")));
    assert.ok(cap.warns.some((w) => /<redacted/.test(w)));
  } finally {
    restoreArgv();
    cap.restore();
  }
});

// ---- parseEnvHeaders ----

test("parseEnvHeaders: valid JSON object", () => {
  try {
    process.env.MG_EXTRA_HEADERS = JSON.stringify({ "X-Custom": "val", A: "b" });
    assert.deepEqual(parseEnvHeaders(), { "X-Custom": "val", A: "b" });
  } finally {
    delete process.env.MG_EXTRA_HEADERS;
  }
});

test("parseEnvHeaders: non-string value filtered + warn", () => {
  const cap = captureWarn();
  try {
    process.env.MG_EXTRA_HEADERS = JSON.stringify({ k: 1, ok: "v" });
    assert.deepEqual(parseEnvHeaders(), { ok: "v" });
    assert.ok(cap.warns.some((w) => /must be a string/.test(w)));
  } finally {
    delete process.env.MG_EXTRA_HEADERS;
    cap.restore();
  }
});

test("parseEnvHeaders: invalid JSON -> warn + {}", () => {
  const cap = captureWarn();
  try {
    process.env.MG_EXTRA_HEADERS = "not json";
    assert.deepEqual(parseEnvHeaders(), {});
    assert.match(cap.warns[0], /not valid JSON/);
  } finally {
    delete process.env.MG_EXTRA_HEADERS;
    cap.restore();
  }
});

test("parseEnvHeaders: array -> warn + {}", () => {
  const cap = captureWarn();
  try {
    process.env.MG_EXTRA_HEADERS = "[1,2,3]";
    assert.deepEqual(parseEnvHeaders(), {});
    assert.match(cap.warns[0], /must be a JSON object/);
  } finally {
    delete process.env.MG_EXTRA_HEADERS;
    cap.restore();
  }
});

test("parseEnvHeaders: unset -> {}", () => {
  delete process.env.MG_EXTRA_HEADERS;
  assert.deepEqual(parseEnvHeaders(), {});
});

// ---- getEffectiveHeaders: env + CLI merge ----

test("getEffectiveHeaders: CLI overrides env", () => {
  try {
    resetEffectiveHeadersCache();
    process.env.MG_EXTRA_HEADERS = JSON.stringify({ A: "env", B: "env" });
    withArgv("--header", "B: cli", "--header", "C: cli");
    assert.deepEqual(getEffectiveHeaders(), { A: "env", B: "cli", C: "cli" });
  } finally {
    delete process.env.MG_EXTRA_HEADERS;
    restoreArgv();
    resetEffectiveHeadersCache();
  }
});

test("getEffectiveHeaders: env headers apply when no CLI override", () => {
  try {
    resetEffectiveHeadersCache();
    process.env.MG_EXTRA_HEADERS = JSON.stringify({ "X-Gateway-Auth": "secret" });
    withArgv(); // no CLI headers
    assert.deepEqual(getEffectiveHeaders(), { "X-Gateway-Auth": "secret" });
  } finally {
    delete process.env.MG_EXTRA_HEADERS;
    restoreArgv();
    resetEffectiveHeadersCache();
  }
});

// ---- maskSensitiveHeaders ----

test("maskSensitiveHeaders: masks known sensitive keys, leaves others intact", () => {
  assert.deepEqual(
    maskSensitiveHeaders({
      Authorization: "Bearer secret",
      "X-Public": "ok",
      "X-MG-UserAccessToken": "t",
      Cookie: "c",
    }),
    {
      Authorization: "<masked>",
      "X-Public": "ok",
      "X-MG-UserAccessToken": "<masked>",
      Cookie: "<masked>",
    }
  );
});

test("maskSensitiveHeaders: case-insensitive match", () => {
  assert.deepEqual(
    maskSensitiveHeaders({ authorization: "x", "API-KEY": "k", "X-Trace-Id": "t" }),
    { authorization: "<masked>", "API-KEY": "<masked>", "X-Trace-Id": "t" }
  );
});

test("maskSensitiveHeaders: empty input -> empty output", () => {
  assert.deepEqual(maskSensitiveHeaders({}), {});
});
