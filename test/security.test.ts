import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedHttpUrl,
  isReadableHtmlFilePath,
  isWritableWorkspaceRoot,
  sanitizeFileName,
} from "../src/utils/security";

// ---------------------------------------------------------------------------
// isAllowedHttpUrl — SSRF gate (CVE-2026-15750)
// Lock down: public http(s) allowed; non-HTTP protocols, loopback/private/
// reserved targets (including obfuscated IPv4 forms and IPv4-mapped IPv6)
// rejected; explicit allowHosts (private-deploy API base) overrides.
// ---------------------------------------------------------------------------

test("isAllowedHttpUrl: public https/http URLs are allowed", () => {
  assert.deepEqual(isAllowedHttpUrl("https://example.com/docs"), { ok: true });
  assert.deepEqual(isAllowedHttpUrl("http://example.com/docs"), { ok: true });
  assert.deepEqual(isAllowedHttpUrl("http://8.8.8.8/x"), { ok: true });
  assert.deepEqual(isAllowedHttpUrl("https://-component-doc.example.com:443/a?b=c"), { ok: true });
});

test("isAllowedHttpUrl: rejects unparseable input", () => {
  assert.equal(isAllowedHttpUrl("not-a-url").ok, false);
  assert.equal(isAllowedHttpUrl("").ok, false);
});

test("isAllowedHttpUrl: rejects non-HTTP(S) protocols", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com/x",
    "gopher://example.com/",
  ]) {
    const r = isAllowedHttpUrl(url);
    assert.equal(r.ok, false, url);
    assert.match(r.reason ?? "", /protocol/i, url);
  }
});

test("isAllowedHttpUrl: rejects loopback and localhost variants", () => {
  for (const url of [
    "http://localhost/",
    "http://LOCALHOST/",
    "http://localhost:8080/",
    "http://127.0.0.1/",
    "http://127.1/", // WHATWG canonicalizes to 127.0.0.1
    "http://2130706433/", // decimal IPv4 -> 127.0.0.1
    "http://0x7f000001/", // hex IPv4 -> 127.0.0.1
    "http://0177.0.0.1/", // octal IPv4 -> 127.0.0.1
    "http://[::1]/",
    "http://[::]/",
    "http://app.localhost/",
  ]) {
    assert.equal(isAllowedHttpUrl(url).ok, false, url);
  }
});

test("isAllowedHttpUrl: rejects private and reserved IPv4 ranges", () => {
  for (const url of [
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://100.64.0.1/", // CGNAT
    "http://198.18.0.1/", // benchmark
    "http://0.0.0.0/",
    "http://224.0.0.1/", // multicast
    "http://255.255.255.255/",
  ]) {
    assert.equal(isAllowedHttpUrl(url).ok, false, url);
  }
  // 172.32+ is public
  assert.equal(isAllowedHttpUrl("http://172.32.0.1/").ok, true);
});

test("isAllowedHttpUrl: rejects private IPv6 and IPv4-mapped IPv6", () => {
  for (const url of [
    "http://[fe80::1]/", // link-local
    "http://[fd00::1]/", // ULA
    "http://[::ffff:127.0.0.1]/", // v4-mapped loopback
    "http://[::ffff:169.254.169.254]/", // v4-mapped metadata
    "http://[64:ff9b::7f00:1]/", // NAT64 loopback
  ]) {
    assert.equal(isAllowedHttpUrl(url).ok, false, url);
  }
  assert.equal(isAllowedHttpUrl("http://[2606:4700::1111]/").ok, true); // public v6
});

test("isAllowedHttpUrl: rejects reserved hostname suffixes", () => {
  for (const url of [
    "http://foo.local/",
    "http://metadata.google.internal/",
    "http://router.home.arpa/",
  ]) {
    assert.equal(isAllowedHttpUrl(url).ok, false, url);
  }
});

test("isAllowedHttpUrl: allowHosts permits explicitly configured deploy host even if private", () => {
  const opts = { allowHosts: ["http://10.0.0.5:3000"] };
  assert.deepEqual(isAllowedHttpUrl("http://10.0.0.5:3000/docs", opts), { ok: true });
  // different port / different host still blocked
  assert.equal(isAllowedHttpUrl("http://10.0.0.5:4000/docs", opts).ok, false);
  assert.equal(isAllowedHttpUrl("http://10.0.0.6:3000/docs", opts).ok, false);
  assert.equal(isAllowedHttpUrl("http://10.0.0.5/docs", opts).ok, false);
});

test("isAllowedHttpUrl: invalid allowHosts entries are ignored, never throw", () => {
  const opts = { allowHosts: ["garbage"] };
  assert.equal(isAllowedHttpUrl("http://example.com/", opts).ok, true);
  assert.equal(isAllowedHttpUrl("http://10.0.0.1/", opts).ok, false);
});

// ---------------------------------------------------------------------------
// isReadableHtmlFilePath — path traversal gate (CVE-2026-15749)
// ---------------------------------------------------------------------------

test("isReadableHtmlFilePath: accepts absolute .html/.htm paths (case-insensitive)", () => {
  assert.deepEqual(isReadableHtmlFilePath("/Users/x/proj/index.html"), { ok: true });
  assert.deepEqual(isReadableHtmlFilePath("/Users/x/proj/PAGE.HTM"), { ok: true });
});

test("isReadableHtmlFilePath: rejects relative paths", () => {
  assert.equal(isReadableHtmlFilePath("index.html").ok, false);
  assert.equal(isReadableHtmlFilePath("./index.html").ok, false);
  assert.equal(isReadableHtmlFilePath("../index.html").ok, false);
});

test("isReadableHtmlFilePath: rejects non-HTML extensions and extensionless paths", () => {
  for (const p of [
    "/etc/passwd",
    "/Users/x/.ssh/id_rsa",
    "/Users/x/.aws/credentials",
    "/Users/x/file.txt",
    "/Users/x/file.json",
    "/Users/x/file",
    "/Users/x/file.html/../../secret",
  ]) {
    assert.equal(isReadableHtmlFilePath(p).ok, false, p);
  }
});

test("isReadableHtmlFilePath: rejects empty and NUL-containing paths", () => {
  assert.equal(isReadableHtmlFilePath("").ok, false);
  assert.equal(isReadableHtmlFilePath("/a\0.html").ok, false);
});

// ---------------------------------------------------------------------------
// isWritableWorkspaceRoot — path traversal gate (CVE-2026-15751)
// ---------------------------------------------------------------------------

test("isWritableWorkspaceRoot: accepts normal absolute project dirs", () => {
  assert.deepEqual(isWritableWorkspaceRoot("/Users/x/proj"), { ok: true });
  assert.deepEqual(isWritableWorkspaceRoot("/Users/x/proj/"), { ok: true });
});

test("isWritableWorkspaceRoot: rejects relative paths", () => {
  assert.equal(isWritableWorkspaceRoot("proj").ok, false);
  assert.equal(isWritableWorkspaceRoot("./proj").ok, false);
  assert.equal(isWritableWorkspaceRoot("../proj").ok, false);
});

test("isWritableWorkspaceRoot: rejects filesystem root", () => {
  assert.equal(isWritableWorkspaceRoot("/").ok, false);
});

test("isWritableWorkspaceRoot: rejects empty and NUL-containing input", () => {
  assert.equal(isWritableWorkspaceRoot("").ok, false);
  assert.equal(isWritableWorkspaceRoot("/a\0b").ok, false);
});

// ---------------------------------------------------------------------------
// sanitizeFileName — filename component hardening (CVE-2026-15751 companion)
// ---------------------------------------------------------------------------

test("sanitizeFileName: strips path separators and traversal sequences", () => {
  // 首尾下划线会被修剪：../../etc/passwd → etc_passwd
  assert.equal(sanitizeFileName("../../etc/passwd"), "etc_passwd");
  const out = sanitizeFileName("a/b\\c..d/e");
  assert.doesNotMatch(out, /[\/\\]/);
  assert.doesNotMatch(out, /\.\./);
});

test("sanitizeFileName: keeps normal names intact", () => {
  assert.equal(sanitizeFileName("Button-Primary_v2"), "Button-Primary_v2");
  assert.equal(sanitizeFileName("btn.label"), "btn.label");
});

test("sanitizeFileName: empty result falls back", () => {
  assert.equal(sanitizeFileName("..", "component"), "component");
  assert.equal(sanitizeFileName("", "component"), "component");
  assert.equal(sanitizeFileName("///", "component"), "component");
});
