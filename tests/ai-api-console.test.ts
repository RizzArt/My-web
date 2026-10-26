import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { customerAiApiOverviewResponse } from "@/lib/ai-api/account";

function source(path: string) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const schema = source("prisma/schema.prisma");
const customerKeys = () => source("src/app/api/account/ai-api/keys/route.ts");
const customerRevoke = () => source("src/app/api/account/ai-api/keys/[keyId]/revoke/route.ts");
const customerOverview = () => source("src/app/api/account/ai-api/overview/route.ts");
const accountService = () => source("src/lib/ai-api/account.ts");
const customerPage = () => source("src/app/dashboard/api/page.tsx");
const customerConsole = () => source("src/components/customer-ai-api-console.tsx");
const adminPage = () => source("src/app/admin/ai-api/page.tsx");
const adminConsole = () => source("src/components/admin-ai-api-manager.tsx");
const header = source("src/components/header.tsx");
const mobileMenu = source("src/components/mobile-menu.tsx");
const globals = source("src/app/globals.css");

describe("AI API customer console and admin control plane", () => {
  it("serializes populated wallet, key, ledger, and daily BigInt values into JSON-safe data", () => {
    const now = new Date("2026-10-18T00:00:00.000Z");
    const response = customerAiApiOverviewResponse({
      wallet: {
        availableMicros: 1_234_567n,
        reservedMicros: 23n,
        dailySpendLimitMicros: 9_000_000n,
        isFrozen: false,
        frozenReason: null,
        keys: [],
        ledgerEntries: [],
        dailyUsage: [],
      },
      keys: [{ id: "key-1", name: "test", prefix: "rz_live_test", status: "ACTIVE", expiresAt: null, lastUsedAt: null, createdAt: now, rateLimitPerMinute: 60, concurrencyLimit: 2, dailySpendLimitMicros: 8_000_000n }],
      ledger: [{ id: "ledger-1", kind: "FUND", availableDeltaMicros: 1_234_567n, reservedDeltaMicros: 0n, availableAfterMicros: 1_234_567n, reservedAfterMicros: 0n, safeReasonCode: null, createdAt: now }],
      daily: { spentMicros: 100n, reservedMicros: 23n, admittedRequestCount: 7n },
      dailyHistory: [{ usageDate: now, spentMicros: 100n, reservedMicros: 23n, admittedRequestCount: 7n }],
    });
    const json = JSON.stringify(response);
    expect(json).toContain('"availableMicros":"1234567"');
    expect(json).toContain('"dailySpendLimitMicros":"8000000"');
    expect(json).toContain('"availableDeltaMicros":"1234567"');
    expect(json).toContain('"admittedRequestCount":"7"');
    expect(response.wallet?.reservedMicros).toBe("23");
  });

  it("keeps customer ownership and plaintext-key issuance server-side", () => {
    expect(customerKeys()).toContain('z.object({ name:');
    expect(customerKeys()).toContain("userId: session.user.id");
    expect(customerKeys()).toContain("sensitiveJsonHeaders");
    expect(customerKeys()).toContain("Idempotency-Key");
    expect(customerRevoke()).toContain("session.user.id");
    expect(customerRevoke()).toContain("revokeCustomerAiApiKey");
    expect(customerOverview()).not.toContain("secretHash");
    expect(customerOverview()).not.toContain("upstreamIdempotencyKey");
    expect(accountService()).toContain("customerAiApiOverviewResponse");
    expect(accountService()).toContain("dailyHistory");
    expect(accountService()).toContain("admittedRequestCount: data.daily.admittedRequestCount.toString()");
    expect(accountService()).toContain("admittedRequestCount: row.admittedRequestCount.toString()");
  });

  it("makes issuance replay-safe and keeps API Balance isolated", () => {
    expect(schema).toMatch(/issuanceEventKey\s+String\?\s+@unique/);
    expect(accountService()).toContain("MAX_ACTIVE_CUSTOMER_KEYS");
    expect(accountService()).toContain("issuanceEventKey");
    expect(accountService()).toContain("wallet: { userId: input.userId }");
    expect(accountService()).not.toContain("studioCredits");
    expect(accountService()).not.toContain("user.balance");
    expect(customerConsole()).toContain("riezz99-ai-api-key-issuance-idempotency");
    expect(customerConsole()).toContain("sessionStorage.getItem");
    expect(customerConsole()).toContain("sessionStorage.removeItem");
    expect(adminConsole()).toContain("riezz99-admin-ai-api-key-issuance-idempotency");
  });

  it("renders a professional scoped dark API console and one-time key reveal", () => {
    expect(customerPage()).toContain("requireUser()");
    expect(customerConsole()).toContain("plaintextKey");
    expect(customerConsole()).toContain("navigator.clipboard.writeText");
    expect(customerConsole()).not.toContain("localStorage");
    expect(customerConsole()).not.toContain("sessionStorage.setItem(\"plaintextKey\"");
    expect(globals).toContain(".api-pro-shell");
    expect(globals).toContain(".api-pro-secret");
    expect(globals).toContain("#a3ff12");
  });

  it("documents Responses API and secret-safe Codex configuration", () => {
    expect(customerConsole()).toContain("/v1/responses");
    expect(customerConsole()).toContain('wire_api = "responses"');
    expect(customerConsole()).toContain('env_key = "RIEZZ99_API_KEY"');
    expect(customerConsole()).toContain('base_url = "https://api.riezz99.biz.id/v1"');
    expect(customerConsole()).toContain('web_search = "disabled"');
    expect(customerConsole()).toContain("Idempotency-Key: UUID-baru");
    expect(customerConsole()).toContain("export RIEZZ99_API_KEY");
    expect(customerConsole()).not.toContain("rz_live_abcdefghijklmnopqrstuvwxyz");
  });

  it("adds customer and admin navigation without collapsing their permissions", () => {
    expect(header).toContain('/dashboard/api#keys');
    expect(header).toContain('/dashboard/api#balance');
    expect(header).toContain('/admin/ai-api');
    expect(mobileMenu).toContain('["API Keys", "/dashboard/api#keys"]');
    expect(mobileMenu).toContain('["API Balance", "/dashboard/api#balance"]');
    expect(mobileMenu).toContain('["AI API", "/admin/ai-api"]');
    expect(adminPage()).toContain("requireAdmin()");
    expect(adminConsole()).toContain("/api/admin/ai-api/fund");
    expect(adminConsole()).toContain("/api/admin/ai-api/models");
  });
});
