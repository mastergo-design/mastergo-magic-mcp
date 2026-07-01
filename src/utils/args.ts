function getArgs(): string[] {
  return process.argv.slice(2);
}

function parseToken(): string {
  const args = getArgs();
  let token = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--token" && i + 1 < args.length) {
      token = args[i + 1];
      break;
    } else if (args[i].startsWith("--token=")) {
      token = args[i].split("=")[1];
      break;
    }
  }

  return token;
}

function parseUrl(): string {
  const args = getArgs();
  let baseUrl = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && i + 1 < args.length) {
      baseUrl = args[i + 1];
      break;
    } else if (args[i].startsWith("--url=")) {
      baseUrl = args[i].split("=")[1];
      break;
    }
  }

  return baseUrl;
}

function parseRules(): string[] {
  const args = getArgs();
  const rules: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rule" && i + 1 < args.length) {
      rules.push(args[i + 1]);
    } else if (args[i].startsWith("--rule=")) {
      rules.push(args[i].split("=")[1]);
    }
  }

  return rules;
}

function parseDebug(): boolean {
  const args = getArgs();

  for (const arg of args) {
    if (arg === "--debug") {
      return true;
    }
  }

  return false;
}

function parseNoRule(): boolean {
  const args = getArgs();

  for (const arg of args) {
    if (arg === "--no-rule") {
      return true;
    }
  }

  return false;
}

function parseProxy(): string {
  const args = getArgs();
  let proxy = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--proxy" && i + 1 < args.length) {
      proxy = args[i + 1];
      break;
    } else if (args[i].startsWith("--proxy=")) {
      proxy = args[i].split("=")[1];
      break;
    }
  }

  return proxy;
}

// Truncate raw header input in warnings so we don't echo long/secret-like values
// back to the console.
const truncateForWarn = (s: string, max = 32) => (s.length > max ? `${s.slice(0, max)}…` : s);

// Known sensitive header keys (lowercased substring match) masked in debug output.
const SENSITIVE_HEADER_KEYS = [
  "authorization",
  "token",
  "secret",
  "password",
  "cookie",
  "api-key",
  "apikey",
];

const isSensitiveHeader = (key: string): boolean => {
  const lk = key.toLowerCase();
  return SENSITIVE_HEADER_KEYS.some((s) => lk.includes(s));
};

// Format a raw header value for warning output. Invalid headers often have no
// clean `:` separator (e.g. `Authorization Bearer eyJ...`), so we can't rely on
// the parsed key — match sensitive keywords against the WHOLE raw string and, on
// any hit, hide it entirely (length only). We must never echo even a truncated
// prefix of a credential: stderr is routinely captured by log collectors, and a
// mis-typed auth header is the most common invalid-input case. Non-sensitive
// values are still shown (truncated) so users can debug ordinary typos.
const redactForWarn = (raw: string): string => {
  const lower = raw.toLowerCase();
  if (SENSITIVE_HEADER_KEYS.some((s) => lower.includes(s))) {
    return `<redacted, length=${raw.length}>`;
  }
  return `"${truncateForWarn(raw)}"`;
};

// Parse `--header "Key: Value"` (repeatable). Invalid inputs (missing value,
// a following flag, missing ":", empty key) are skipped with a `console.warn` so
// a misconfigured gateway/auth header doesn't fail silently (issue #64).
function parseHeaders(): Record<string, string> {
  const args = getArgs();
  const headers: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    let raw: string;

    if (args[i] === "--header") {
      const next = i + 1 < args.length ? args[i + 1] : undefined;
      if (next === undefined) {
        console.warn(
          `[--header] missing value (expected --header "Key: Value" or --header=Key:Value).`
        );
        continue;
      }
      // Don't swallow a following flag — it belongs to its own parser and the user
      // almost certainly forgot the header value. Leave it for the next iteration so
      // later --header occurrences and other flags are still seen (review #3).
      if (next.startsWith("--")) {
        console.warn(
          `[--header] missing value: next argument ${redactForWarn(next)} looks like a flag, not a header value.`
        );
        continue;
      }
      raw = next;
      i++;
    } else if (args[i].startsWith("--header=")) {
      raw = args[i].slice("--header=".length);
    } else {
      continue;
    }

    if (!raw) {
      console.warn(
        `[--header] received an empty value (expected --header "Key: Value" or --header=Key:Value).`
      );
      continue;
    }

    const sep = raw.indexOf(":");
    if (sep === -1) {
      console.warn(`Skipping invalid --header (missing ":" separator): ${redactForWarn(raw)}`);
    } else if (sep === 0) {
      console.warn(`Skipping invalid --header (empty header name before ":"): ${redactForWarn(raw)}`);
    } else {
      const key = raw.slice(0, sep).trim();
      const value = raw.slice(sep + 1).trim();
      if (value === "") {
        console.warn(
          `--header "${key}" has an empty value — if unintended, quote the value (e.g. --header "${key}: value"); shells split unquoted values that contain spaces.`
        );
      }
      headers[key] = value;
    }
  }

  return headers;
}

// Parse custom headers from the `MG_EXTRA_HEADERS` env var (a JSON object, e.g.
// `{"X-Custom":"val"}`). Lets users pass secrets without putting them in
// `process.argv` (visible via `ps`). CLI `--header` takes precedence over env.
function parseEnvHeaders(): Record<string, string> {
  const raw = process.env.MG_EXTRA_HEADERS;
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `MG_EXTRA_HEADERS is not valid JSON — ignoring. Expected a JSON object like '{"X-Custom":"val"}'.`
    );
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(
      `MG_EXTRA_HEADERS must be a JSON object — ignoring (got ${Array.isArray(parsed) ? "array" : typeof parsed}).`
    );
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") {
      console.warn(`MG_EXTRA_HEADERS header "${k}" ignored — value must be a string (got ${typeof v}).`);
      continue;
    }
    headers[k] = v;
  }
  return headers;
}

// Merge env + CLI custom headers. CLI `--header` overrides env, and both override
// the defaults in getCommonHeader() (Content-Type / auth token). Single source of
// truth consumed by api.ts and the index.ts debug output.
//
// Memoized: argv and MG_EXTRA_HEADERS don't change after process boot, but this
// is on the per-request hot path (getCommonHeader() is called by every HTTP
// method in api.ts) — without caching we'd JSON.parse the env blob and walk argv
// on every request. Callers spread the result into a new object, so returning the
// cached reference is safe (no downstream mutation).
let _effectiveHeadersCache: Record<string, string> | null = null;

function getEffectiveHeaders(): Record<string, string> {
  if (_effectiveHeadersCache) return _effectiveHeadersCache;
  _effectiveHeadersCache = { ...parseEnvHeaders(), ...parseHeaders() };
  return _effectiveHeadersCache;
}

// Test-only hook: clear the memoized cache so unit tests can drive
// getEffectiveHeaders() with fresh argv/env. No-op in production.
export function resetEffectiveHeadersCache(): void {
  _effectiveHeadersCache = null;
}

// Return a shallow copy with known sensitive header values masked, so debug logs
// don't leak credentials.
function maskSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    masked[k] = isSensitiveHeader(k) ? "<masked>" : v;
  }
  return masked;
}

// Returns the raw --format value, or `undefined` when the flag is absent.
// An explicit empty value (`--format=`) is returned as "" so the caller can warn
// rather than silently falling back.
function parseFormat(): string | undefined {
  const args = getArgs();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && i + 1 < args.length) {
      return args[i + 1];
    } else if (args[i].startsWith("--format=")) {
      return args[i].split("=")[1];
    }
  }

  return undefined;
}

export function parserArgs(): {
  token: string;
  baseUrl: string;
  rules: string[];
  debug: boolean;
  noRule: boolean;
  proxy: string;
  format: string | undefined;
} {
  const token = parseToken();
  const baseUrl = parseUrl();
  const rules = parseRules();
  const debug = parseDebug();
  const noRule = parseNoRule();
  const proxy = parseProxy();
  const format = parseFormat();

  return {
    token,
    baseUrl,
    rules,
    debug,
    noRule,
    proxy,
    format,
  };
}

export { parseToken, parseUrl, parseRules, parseDebug, parseNoRule, parseProxy, parseFormat, parseHeaders, parseEnvHeaders, getEffectiveHeaders, maskSensitiveHeaders, getArgs };
