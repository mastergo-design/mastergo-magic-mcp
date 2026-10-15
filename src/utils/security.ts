import path from "path";

/**
 * URL / 文件路径安全校验工具。
 *
 * 集中处理三处安全漏洞的防护逻辑：
 * - CVE-2026-15750: getComponentLink 的 url 参数可被指向内网地址（SSRF），
 *   请求前须经过 isAllowedHttpUrl 校验。
 * - CVE-2026-15749: C2d 的 filePath 参数无目录/类型约束（路径穿越），
 *   读取前须经过 isReadableHtmlFilePath 校验。
 * - CVE-2026-15751: getComponentGenerator 的 rootPath 参数未校验（路径穿越），
 *   写入前须经过 isWritableWorkspaceRoot 校验，动态文件名须经过 sanitizeFileName。
 *
 * 背景：MCP 工具入参由 LLM 生成，设计稿内容可被注入提示词诱导 LLM 调用工具。
 * URL 与路径参数一律视为不可信输入。
 */

export interface SafetyCheckResult {
  ok: boolean;
  /** 校验失败原因（面向 LLM 的英文说明，可直接拼进错误返回） */
  reason?: string;
}

// ---------------------------------------------------------------------------
// URL 安全校验（SSRF 防护）
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 是否落在内网/保留段。入参须是标准点分十进制。 */
function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(IPV4_RE);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true; // 0/8 未指定、10/8 私网、127/8 回环
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT（Tailscale 等）
  if (a === 169 && b === 254) return true; // 169.254/16 链路本地（含 169.254.169.254 云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 私网
  if (a === 192 && b === 168) return true; // 192.168/16 私网
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 基准测试保留
  if (a >= 224) return true; // 组播/保留/广播（224/4、240/4、255.255.255.255）
  return false;
}

/**
 * 把（已由 WHATWG URL 规范化的小写）IPv6 字面量展开成 8 组 16 位整数。
 * WHATWG 规范化保证 IPv6 字面量形如 `::1` / `fe80::1` / `::ffff:7f00:1`，
 * 不会出现缩写不合法的形态；解析失败时返回 null（调用方按拒绝处理，防御性兜底）。
 */
function expandIpv6(host: string): number[] | null {
  const withoutZone = host.split("%")[0]; // 去掉 zone-id（如 fe80::1%25eth0）
  const sections = withoutZone.split("::");
  if (sections.length > 2) return null;
  const head = sections[0] ? sections[0].split(":") : [];
  const tail = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  const filler = 8 - head.length - tail.length;
  if (filler < (sections.length === 2 ? 1 : 0)) return null;
  const groups = [...head, ...Array(filler).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateIpv6(host: string): boolean {
  const groups = expandIpv6(host);
  // URL 规范化后含冒号的 host 一定是 IPv6 字面量；解析失败按拒绝处理。
  if (!groups) return true;

  if (groups.every((g) => g === 0)) return true; // :: 未指定地址
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1 回环

  // ::ffff:0:0/96 IPv4 映射地址、64:ff9b::/96 NAT64 已知前缀：
  // 末 32 位就是真实 IPv4 目标，按 IPv4 规则复核。
  const v4Mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const nat64 =
    groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
  if (v4Mapped || nat64) {
    const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
    return isPrivateIpv4(ipv4);
  }

  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地地址（ULA）
  return false;
}

/**
 * 主机名是否指向内网/回环/保留地址。
 * 入参为 URL.hostname：IPv6 字面量带方括号，先剥离。
 */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return isPrivateIpv6(host);
  if (IPV4_RE.test(host)) return isPrivateIpv4(host);
  // 保留域名后缀：RFC 6761/6762 保证 localhost 解析到回环；.local（mDNS）、
  // .internal（RFC 8375，含 GCP metadata.google.internal）、.home.arpa 均为内网语义。
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

export interface IsAllowedHttpUrlOptions {
  /**
   * 额外放行的 host（host:port，可传完整 URL / URL 实例）。
   * 用途：私有化部署时用户显式配置的 API 地址本身就是内网地址，
   * 该 host 上的请求属于正常业务，不能被 SSRF 防护误杀。
   */
  allowHosts?: Array<string | URL>;
}

/**
 * 校验一个不可信 URL 是否允许发起 HTTP 请求（SSRF 防护）。
 *
 * 规则：
 * 1. 必须能被 WHATWG URL 解析；
 * 2. 协议仅允许 http/https（拦截 file:/javascript:/data: 等）；
 * 3. 主机名命中内网/回环/保留段（含编码变形，见 isPrivateHostname）即拒绝；
 * 4. 命中 allowHosts（用户显式配置的部署地址）时放行，优先级高于规则 3。
 */
export function isAllowedHttpUrl(
  rawUrl: string,
  opts?: IsAllowedHttpUrlOptions
): SafetyCheckResult {
  let urlObj: URL;
  try {
    urlObj = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Invalid URL: ${JSON.stringify(rawUrl)}` };
  }

  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    return {
      ok: false,
      reason: `Blocked non-HTTP(S) protocol "${urlObj.protocol}", only http/https is allowed`,
    };
  }

  if (opts?.allowHosts?.length) {
    const allowed = new Set<string>();
    for (const item of opts.allowHosts) {
      try {
        allowed.add(item instanceof URL ? item.host : new URL(item).host);
      } catch {
        // 非法 allowHosts 条目直接忽略
      }
    }
    if (allowed.has(urlObj.host)) return { ok: true };
  }

  if (isPrivateHostname(urlObj.hostname)) {
    return {
      ok: false,
      reason: `Blocked request to private/loopback/reserved address "${urlObj.hostname}" (SSRF protection)`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 文件路径校验（路径穿越防护）
// ---------------------------------------------------------------------------

function containsNul(...parts: Array<string | undefined>): boolean {
  return parts.some((p) => typeof p === "string" && p.includes("\0"));
}

const READABLE_HTML_EXTENSIONS = [".html", ".htm"];

/**
 * 校验 C2d 的 filePath：仅允许指向磁盘上的 .html/.htm 文件（工具契约即
 * 「同步 HTML 文件」），且必须是绝对路径。扩展名白名单从根上杜绝读取
 * /etc/passwd、~/.ssh/id_rsa、~/.aws/credentials 等敏感文件。
 */
export function isReadableHtmlFilePath(filePath: string): SafetyCheckResult {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return { ok: false, reason: "filePath must be a non-empty string" };
  }
  if (containsNul(filePath)) {
    return { ok: false, reason: "filePath contains NUL bytes" };
  }
  if (!path.isAbsolute(filePath)) {
    return {
      ok: false,
      reason: `filePath must be an absolute path, got: "${filePath}"`,
    };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!READABLE_HTML_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: `filePath must point to an HTML file (${READABLE_HTML_EXTENSIONS.join(" / ")}), got extension: "${ext || "(none)"}"`,
    };
  }
  return { ok: true };
}

/**
 * 校验工作流工具的 rootPath：必须是绝对路径、非文件系统根目录。
 * 与 get-flutter-workflow 既有校验保持同一口径，并额外拒绝根目录
 * （把 .mastergo 写到 / 或 C:\ 没有业务意义，纯属误用/滥用）。
 */
export function isWritableWorkspaceRoot(rootPath: string): SafetyCheckResult {
  if (typeof rootPath !== "string" || rootPath.length === 0) {
    return { ok: false, reason: "rootPath must be a non-empty string" };
  }
  if (containsNul(rootPath)) {
    return { ok: false, reason: "rootPath contains NUL bytes" };
  }
  if (!path.isAbsolute(rootPath)) {
    return {
      ok: false,
      reason: `rootPath must be an absolute path, got: "${rootPath}". Please provide an absolute path to the project root.`,
    };
  }
  if (path.resolve(rootPath) === path.parse(path.resolve(rootPath)).root) {
    return {
      ok: false,
      reason: `rootPath must be a project directory, not the filesystem root: "${rootPath}"`,
    };
  }
  return { ok: true };
}

/**
 * 把不可信字符串消毒成安全文件名：剥掉路径分隔符与穿越序列，
 * 只保留 [a-zA-Z0-9._-]，空结果回退到 fallback。与 get-flutter-workflow
 * 的 safeName 同一套规则，抽出复用。
 */
export function sanitizeFileName(raw: string, fallback = "unnamed"): string {
  const sanitized = String(raw ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_") // 防止连续点号
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}
