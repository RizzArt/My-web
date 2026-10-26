import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POST } from "@/app/api/webhooks/sociabuzz/test/route";
import {
  FixedWindowRateLimiter,
  SOCIABUZZ_DIAGNOSTIC_MAX_BODY_BYTES,
  summarizeSociaBuzzDiagnosticPayload,
} from "@/lib/webhooks/sociabuzz-diagnostic";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SociaBuzz diagnostic webhook sanitization", () => {
  it("keeps useful payload fields while redacting credentials and personal data", () => {
    const report = summarizeSociaBuzzDiagnosticPayload(JSON.stringify({
      event: "payment.paid",
      amount: 15000,
      token: "webhook-token-must-not-appear",
      nested: { signature: "signature-must-not-appear", invoice_id: "INV-123" },
      customer_email: "buyer@example.test",
      unexpected_value: "also-must-not-appear",
    }), "application/json");

    const logged = JSON.stringify(report);
    expect(logged).toContain("payment.paid");
    expect(logged).toContain("INV-123");
    expect(logged).not.toContain("webhook-token-must-not-appear");
    expect(logged).not.toContain("signature-must-not-appear");
    expect(logged).not.toContain("buyer@example.test");
    expect(logged).not.toContain("also-must-not-appear");
  });

  it("does not log raw text bodies or invalid JSON", () => {
    const report = summarizeSociaBuzzDiagnosticPayload(
      "authorization=never-log-this",
      "text/plain",
    );
    expect(JSON.stringify(report)).not.toContain("never-log-this");
  });

  it("inspects form notifications without exposing their secrets", () => {
    const report = summarizeSociaBuzzDiagnosticPayload(
      "invoice_id=INV-123&status=paid&signature=must-not-appear",
      "application/x-www-form-urlencoded",
    );
    const logged = JSON.stringify(report);
    expect(logged).toContain("invoice_id");
    expect(logged).toContain("INV-123");
    expect(logged).not.toContain("must-not-appear");
  });

  it("reports the requested SociaBuzz fields and item shape without exposing PII or message text", () => {
    const report = summarizeSociaBuzzDiagnosticPayload(JSON.stringify({
      id: "donation-001",
      amount: 15000,
      currency: "IDR",
      amount_settled: 14500,
      currency_settled: "IDR",
      media_type: "donation",
      level: 3,
      vote: "up",
      created_at: "2026-10-05T04:00:00Z",
      message: "private supporter message",
      content: "private content",
      supporter: "supporter-must-not-appear",
      email_supporter: "supporter@example.test",
      authorization: "Bearer authorization-must-not-appear",
      cookie: "session=cookie-must-not-appear",
      signature: "signature-must-not-appear",
      secret: "secret-must-not-appear",
      api_key: "api-key-must-not-appear",
      item: {
        product_id: "product-123",
        product_name: "Riezz99 Diamond Pack",
        reference: "RZ-ORDER-456",
        supporter: "nested-supporter-must-not-appear",
        buyer_name: "buyer-must-not-appear",
        metadata: { product_id: "product-789", product_name: "Riezz99 Voucher" },
      },
    }), "application/json");

    const logged = JSON.stringify(report);
    expect(logged).toContain("donation-001");
    expect(logged).toContain("14500");
    expect(logged).toContain("donation");
    expect(logged).toContain("Riezz99 Diamond Pack");
    expect(logged).toContain("Riezz99 Voucher");
    expect(logged).toContain('"length":25');
    expect(logged).toContain('"state":"non-empty"');
    expect(logged).not.toContain("private supporter message");
    expect(logged).not.toContain("private content");
    expect(logged).not.toContain("supporter-must-not-appear");
    expect(logged).not.toContain("supporter@example.test");
    expect(logged).not.toContain("authorization-must-not-appear");
    expect(logged).not.toContain("cookie-must-not-appear");
    expect(logged).not.toContain("signature-must-not-appear");
    expect(logged).not.toContain("secret-must-not-appear");
    expect(logged).not.toContain("api-key-must-not-appear");
    expect(logged).not.toContain("nested-supporter-must-not-appear");
    expect(logged).not.toContain("buyer-must-not-appear");
  });
});

describe("SociaBuzz diagnostic webhook rate limiter", () => {
  it("limits one client inside its fixed window without persistence", () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);
    expect(limiter.allow("test-client", 0).allowed).toBe(true);
    expect(limiter.allow("test-client", 1).allowed).toBe(true);
    expect(limiter.allow("test-client", 2)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.allow("test-client", 60_000).allowed).toBe(true);
  });
});

describe("POST /api/webhooks/sociabuzz/test", () => {
  it("reports a matching configured payload token without logging either token", async () => {
    const expectedToken = "test-sociabuzz-webhook-token";
    vi.stubEnv("SOCIABUZZ_WEBHOOK_TOKEN", expectedToken);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid", token: expectedToken }),
    }));

    const diagnostic = JSON.parse(String(log.mock.calls[0]?.[1]));
    const logged = JSON.stringify(log.mock.calls);
    expect(response.status).toBe(200);
    expect(diagnostic).toMatchObject({
      method: "POST",
      pathname: "/api/webhooks/sociabuzz/test",
      content_type: "application/json",
      response_status: 200,
      top_level_keys: ["status", "[redacted]"],
    });
    expect(Date.parse(diagnostic.received_at)).not.toBeNaN();
    expect(diagnostic.token_present).toBe(true);
    expect(diagnostic.token_match).toBe(true);
    expect(logged).not.toContain(expectedToken);
    log.mockRestore();
  });

  it("reports a mismatched payload token without logging either token", async () => {
    const expectedToken = "test-sociabuzz-webhook-token";
    const suppliedToken = "wrong-sociabuzz-webhook-token";
    vi.stubEnv("SOCIABUZZ_WEBHOOK_TOKEN", expectedToken);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid", token: suppliedToken }),
    }));

    const diagnostic = JSON.parse(String(log.mock.calls[0]?.[1]));
    const logged = JSON.stringify(log.mock.calls);
    expect(response.status).toBe(200);
    expect(diagnostic.token_present).toBe(true);
    expect(diagnostic.token_match).toBe(false);
    expect(logged).not.toContain(expectedToken);
    expect(logged).not.toContain(suppliedToken);
    log.mockRestore();
  });

  it("reports an absent payload token", async () => {
    vi.stubEnv("SOCIABUZZ_WEBHOOK_TOKEN", "test-sociabuzz-webhook-token");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    }));

    const diagnostic = JSON.parse(String(log.mock.calls[0]?.[1]));
    const logged = JSON.stringify(log.mock.calls);
    expect(response.status).toBe(200);
    expect(diagnostic.token_present).toBe(false);
    expect(diagnostic.token_match).toBe(false);
    log.mockRestore();
  });

  it("reports an unconfigured webhook token without retrying", async () => {
    vi.stubEnv("SOCIABUZZ_WEBHOOK_TOKEN", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid", token: "body-token-must-not-appear" }),
    }));

    const diagnostic = JSON.parse(String(log.mock.calls[0]?.[1]));
    const logged = JSON.stringify(log.mock.calls);
    expect(response.status).toBe(200);
    expect(diagnostic.token_present).toBe(true);
    expect(diagnostic.token_match).toBe("not_configured");
    expect(logged).not.toContain("body-token-must-not-appear");
    log.mockRestore();
  });

  it("acknowledges only a sanitized diagnostic log", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: {
        Authorization: "Bearer header-secret-must-not-appear",
        Cookie: "session=cookie-secret-must-not-appear",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "paid", token: "body-secret-must-not-appear" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(typeof log.mock.calls[0]?.[1]).toBe("string");
    expect(JSON.stringify(log.mock.calls)).toContain("paid");
    expect(JSON.stringify(log.mock.calls)).not.toContain("header-secret-must-not-appear");
    expect(JSON.stringify(log.mock.calls)).not.toContain("cookie-secret-must-not-appear");
    expect(JSON.stringify(log.mock.calls)).not.toContain("body-secret-must-not-appear");
    log.mockRestore();
  });

  it("redacts sensitive top-level field names and never invokes fulfillment code", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: { "Content-Type": "application/json; boundary=private-value-must-not-appear" },
      body: JSON.stringify({
        payment_id: "pay-123",
        order_number: "ORD-456",
        token: "payload-token-must-not-appear",
      }),
    }));

    const diagnostic = JSON.parse(String(log.mock.calls[0]?.[1]));
    const logged = JSON.stringify(log.mock.calls);
    const routeSource = readFileSync(resolve(process.cwd(), "src/app/api/webhooks/sociabuzz/test/route.ts"), "utf8");
    expect(response.status).toBe(200);
    expect(diagnostic.content_type).toBe("application/json");
    expect(diagnostic.top_level_keys).toEqual(["payment_id", "order_number", "[redacted]"]);
    expect(logged).not.toContain("private-value-must-not-appear");
    expect(logged).not.toContain("payload-token-must-not-appear");
    expect(routeSource).not.toMatch(/prisma|fulfill|customerwallet|sellerearning|delivery/i);
    log.mockRestore();
  });

  it("rejects oversized requests before parsing or logging them", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/webhooks/sociabuzz/test", {
      method: "POST",
      headers: { "Content-Length": String(SOCIABUZZ_DIAGNOSTIC_MAX_BODY_BYTES + 1) },
      body: "x",
    }));

    expect(response.status).toBe(413);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
