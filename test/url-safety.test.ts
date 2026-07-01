import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameHost } from "../src/utils/api";

// isSameHost is the security gate that decides whether a user/LLM-supplied
// shortLink receives credentials. Lock its behavior down — a wrong `true` leaks
// X-MG-UserAccessToken (and custom gateway auth) to an attacker-controlled host.

test("isSameHost: same host, different path -> true", () => {
  assert.equal(isSameHost("https://a.com/goto/x", "https://a.com"), true);
});

test("isSameHost: different host -> false (the core attack case)", () => {
  assert.equal(isSameHost("https://evil.com/goto/x", "https://a.com"), false);
});

test("isSameHost: protocol differs, host same -> true", () => {
  assert.equal(isSameHost("http://a.com/goto/x", "https://a.com"), true);
});

test("isSameHost: port mismatch -> false", () => {
  assert.equal(isSameHost("https://a.com:8080/goto/x", "https://a.com"), false);
});

test("isSameHost: same host with explicit matching port -> true", () => {
  assert.equal(isSameHost("https://a.com:8080/goto/x", "https://a.com:8080"), true);
});

test("isSameHost: subdomain is a different host -> false", () => {
  assert.equal(isSameHost("https://cdn.a.com/goto/x", "https://a.com"), false);
});

test("isSameHost: invalid input returns false, never throws", () => {
  assert.equal(isSameHost("not-a-url", "https://a.com"), false);
  assert.equal(isSameHost("https://a.com", "not-a-url"), false);
  assert.equal(isSameHost("", ""), false);
});
