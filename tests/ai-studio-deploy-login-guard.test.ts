import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirectories: string[] = [];
afterEach(() => { for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function validate(status: number, headers: string, body = "") {
  const directory = mkdtempSync(join(tmpdir(), "login-guard-")); tempDirectories.push(directory);
  const headerPath = join(directory, "headers"); const bodyPath = join(directory, "body");
  writeFileSync(headerPath, headers); writeFileSync(bodyPath, body);
  const { validateNextLoginGuard } = await import("../deployment/check-next-login-guard.mjs");
  return validateNextLoginGuard({ status, expectedBase: "http://127.0.0.1:3102", headersText: headers, body });
}

const htmlHeaders = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: private, no-cache, no-store\r\n\r\n";
const validBody = '<script>NEXT_REDIRECT;replace;/login;307;</script><meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/login" />';

describe("AI Studio deployment login guard", () => {
  it("accepts 401", async () => expect((await validate(401, "HTTP/1.1 401 Unauthorized\r\n\r\n")).valid).toBe(true));
  it("accepts an exact login HTTP redirect", async () => expect((await validate(307, "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login\r\n\r\n")).valid).toBe(true));
  it("rejects dashboard and external redirects", async () => {
    expect((await validate(307, "HTTP/1.1 307 Temporary Redirect\r\nLocation: /dashboard\r\n\r\n")).valid).toBe(false);
    expect((await validate(307, "HTTP/1.1 307 Temporary Redirect\r\nLocation: https://example.test/login\r\n\r\n")).valid).toBe(false);
  });
  it("accepts only the complete Next streaming redirect", async () => expect((await validate(200, htmlHeaders, validBody)).valid).toBe(true));
  it("allows the public AI Studio navigation label in the redirect shell", async () => {
    const body = `${validBody}<header><a href="/studio" aria-label="Buka AI Studio"><span>AI Studio</span></a></header>`;
    expect((await validate(200, htmlHeaders, body)).valid).toBe(true);
  });
  it.each([
    ["bare login text", htmlHeaders, "/login"],
    ["ordinary login page", htmlHeaders, '<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/login" />'],
    ["dashboard marker", htmlHeaders, '<script>NEXT_REDIRECT;replace;/dashboard;307;</script><meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/dashboard" />'],
    ["external marker", htmlHeaders, '<script>NEXT_REDIRECT;replace;https://example.test/login;307;</script><meta id="__next-page-redirect" http-equiv="refresh" content="1;url=https://example.test/login" />'],
    ["protected content", htmlHeaders, `${validBody}<h1>AI Studio</h1><p>Top Up Studio Credit</p>`],
    ["missing no-store", "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nCache-Control: private\r\n\r\n", validBody],
    ["non-html", "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n", validBody],
    ["empty body", htmlHeaders, ""],
  ])("rejects %s", async (_case, headers, body) => expect((await validate(200, headers, body)).valid).toBe(false));
  it("rejects malformed headers", async () => expect((await validate(200, "not-a-http-header", validBody)).valid).toBe(false));
});
