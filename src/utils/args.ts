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

export function parserArgs(): {
  token: string;
  baseUrl: string;
  rules: string[];
  debug: boolean;
} {
  const token = parseToken();
  const baseUrl = parseUrl();
  const rules = parseRules();
  const debug = parseDebug();

  return {
    token,
    baseUrl,
    rules,
    debug,
  };
}

export { parseToken, parseUrl, parseRules, parseDebug, getArgs };
