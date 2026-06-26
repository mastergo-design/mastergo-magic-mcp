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

// 解析 --header "Key: Value" 参数（可重复多次）
function parseHeaders(): Record<string, string> {
  const args = getArgs();
  const headers: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    let raw = "";
    if (args[i] === "--header" && i + 1 < args.length) {
      raw = args[i + 1];
      i++;
    } else if (args[i].startsWith("--header=")) {
      raw = args[i].slice("--header=".length);
    }

    if (raw) {
      const sep = raw.indexOf(":");
      if (sep > 0) {
        const key = raw.slice(0, sep).trim();
        const value = raw.slice(sep + 1).trim();
        headers[key] = value;
      }
    }
  }

  return headers;
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
  headers: Record<string, string>;
  format: string | undefined;
} {
  const token = parseToken();
  const baseUrl = parseUrl();
  const rules = parseRules();
  const debug = parseDebug();
  const noRule = parseNoRule();
  const proxy = parseProxy();
  const headers = parseHeaders();
  const format = parseFormat();

  return {
    token,
    baseUrl,
    rules,
    debug,
    noRule,
    proxy,
    format,
    headers,
  };
}

export { parseToken, parseUrl, parseRules, parseDebug, parseNoRule, parseProxy, parseFormat, parseHeaders, getArgs };
