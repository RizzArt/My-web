import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Seed the existing useState boundary with persisted DTO-shaped fixtures. Do not
// replace either component or rely on the empty first SSR render. Other React
// hooks and the server renderer remain real; effects do not run during SSR.
const state = vi.hoisted(() => ({ cursor: 0, overrides: new Map<number, unknown>() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) => {
      const index = state.cursor++;
      return actual.useState(state.overrides.has(index) ? state.overrides.get(index) : initial);
    }) as typeof actual.useState,
  };
});

// Intentionally import only EXISTING modules: initial RED must be a rendered
// behavior assertion, never a missing proposed helper/component import.
import { AdminAiApiManager } from "@/components/admin-ai-api-manager";
import { CustomerAiApiConsole } from "@/components/customer-ai-api-console";

const persistedModel = {
  id: "griphub/gpt-5.6-terra",
  displayName: "GPT-5.6 Terra (Griphub)",
  enabled: false,
  maxOutputTokens: 8192,
  health: {
    breakerState: "OPEN", healthyUntil: null, consecutiveFailures: 0,
    lastSuccessAt: null, safeReasonCode: "GRIPHUB_BALANCE_AND_IDEMPOTENCY_UNVERIFIED",
  },
  price: {
    version: 7, upstreamInputMicrosPerMillion: "1000000", upstreamOutputMicrosPerMillion: "2000000",
    retailInputMicrosPerMillion: "1500000", retailOutputMicrosPerMillion: "3000000", verifiedAt: null,
  },
};
// These are test DTOs, not a catalog/admission assertion or provider evidence.
const persistedRequest = {
  id: "request-fixture", status: "RECONCILIATION_REQUIRED", reservedMicros: "3000000",
  promptTokens: null, completionTokens: null, safeErrorCode: "BILLING_STATE_UNCONFIRMED",
  providerRequestId: null, upstreamIdempotencyKey: "fixture-idempotency",
  createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z",
  model: { publicId: persistedModel.id }, apiKey: { prefix: "fixture-prefix", wallet: { userId: "user-fixture" } },
};
const persistedOverview = {
  wallet: { availableMicros: "123000000", reservedMicros: "4000000", dailySpendLimitMicros: "1000000000", isFrozen: true, frozenReason: "AUDIT_HOLD" },
  keys: [{ id: "key-fixture", name: "Persisted development key", prefix: "fixture-prefix", status: "ACTIVE", expiresAt: null, lastUsedAt: null, createdAt: "2026-10-24T00:00:00Z", rateLimitPerMinute: 60, concurrencyLimit: 2, dailySpendLimitMicros: "1000000000" }],
  ledger: [{ id: "ledger-fixture", kind: "ADMIN_FUND", availableDeltaMicros: "123000000", reservedDeltaMicros: "0", availableAfterMicros: "123000000", reservedAfterMicros: "0", safeReasonCode: "FIXTURE_AUDIT_REASON", createdAt: "2026-10-24T00:00:00Z" }],
  daily: { usageDate: "2026-10-24", spentMicros: "2000000", reservedMicros: "4000000", admittedRequestCount: "3" },
  dailyHistory: [],
};

const forbiddenFetch = vi.fn(() => { throw new Error("UI tracer must not access network/provider/DB"); });
beforeEach(() => {
  state.cursor = 0;
  state.overrides.clear();
  forbiddenFetch.mockClear();
  vi.stubGlobal("React", React); // Existing test suite uses the classic JSX transform.
  vi.stubGlobal("fetch", forbiddenFetch);
});
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function renderAdmin(models: unknown[] = [persistedModel], extra: Array<[number, unknown]> = []) {
  // Existing AdminAiApiManager hook order: models=2, requests=3, legacy=6,
  // message=8, busy=9. Guard assertions below detect missing populated fixtures.
  state.cursor = 0;
  state.overrides = new Map<number, unknown>([[2, models], ...extra]);
  return renderToStaticMarkup(React.createElement(AdminAiApiManager));
}
function renderCustomer(extra: Array<[number, unknown]> = []) {
  state.cursor = 0;
  state.overrides = new Map<number, unknown>([[0, persistedOverview], ...extra]);
  return renderToStaticMarkup(React.createElement(CustomerAiApiConsole));
}
function modelCards(html: string, count = 1) {
  const cards = html.match(/<article\b[^>]*class="api-pro-model"[^>]*>[\s\S]*?<\/article>/g) ?? [];
  expect(cards, "fixture must reach existing populated model cards").toHaveLength(count);
  return cards;
}
function modelSection(html: string) {
  const start = html.indexOf("<h2>Model availability</h2>");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("<h2>Reconciliation queue</h2>"));
}
function quickstart(html: string) {
  expect(html).toContain("Persisted development key"); // Not initial empty SSR.
  const start = html.indexOf('<section id="quickstart"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("AI API neutral model UI — existing populated boundaries", () => {
  it.each([
    ["griphub/gpt-5.6-terra", "GPT-5.6 Terra (Griphub)", "GPT-5.6 Terra"],
    ["griphub/minimax-m3", "MiniMax M3 via Griphub", "MiniMax M3"],
    ["griphub/gpt-5.6-sol", "GPT-5.6 Sol (Griphub)", "GPT-5.6 Sol"],
  ])("renders persisted %s / %s as neutral heading %s", (id, displayName, expected) => {
    const [card] = modelCards(renderAdmin([{ ...persistedModel, id, displayName }]));
    expect(card).toContain(`<h3>${expected}</h3>`);
  });

  it("uses the known model identity rather than trusting a stale persisted marketing name", () => {
    const [card] = modelCards(renderAdmin([{ ...persistedModel, displayName: "Unverified Griphub marketing alias" }]));
    expect(card).toContain("<h3>GPT-5.6 Terra</h3>");
  });

  it("does not leak provider-prefixed ID or diagnostic branding in a model card", () => {
    const [card] = modelCards(renderAdmin());
    expect(card).toContain("Price v7"); // Prove persisted price/model is rendered first.
    expect(card).not.toMatch(/griphub/i);
  });

  it("does not infer healthy from missing persisted health evidence", () => {
    const [card] = modelCards(renderAdmin([{ ...persistedModel, health: null }]));
    expect(card).toContain("Breaker MISSING");
    expect(text(card)).not.toMatch(/\bhealthy\b/i);
    expect(text(card)).toMatch(/belum.*verifikasi/i);
  });

  it("shows a disabled persisted model as inactive, not as ready", () => {
    const [card] = modelCards(renderAdmin());
    expect(text(card)).toContain("Nonaktif");
    expect(text(card)).not.toMatch(/\bready\b|siap digunakan|validation passed/i);
  });

  it("starts verification reference and model audit reason blank instead of fabricating validation", () => {
    const section = modelSection(renderAdmin());
    expect(section.match(/Verification reference<input\b[^>]*>/)?.[0]).toContain('value=""');
    expect(section.match(/Alasan audit<input\b[^>]*>/)?.[0]).toContain('value=""');
    expect(section).not.toMatch(/sekai-validation|provider validation passed/i);
  });

  it("discovers admitted IDs with authenticated GET /v1/models before the mutation examples", () => {
    const section = text(quickstart(renderCustomer()));
    expect(section).toContain("GET https://api.riezz99.biz.id/v1/models");
    expect(section).toContain("Authorization: Bearer $RIEZZ99_API_KEY");
    expect(section).toContain("data[].id");
    expect(section.indexOf("/v1/models")).toBeLessThan(section.indexOf("POST https://api.riezz99.biz.id/v1/responses"));
  });

  it("uses an explicit discovery placeholder in all three examples, never a retired or inactive model", () => {
    const section = text(quickstart(renderCustomer()));
    expect(section).not.toContain("minimax/minimax-m3");
    expect(section).not.toMatch(/griphub\//i);
    expect(section).toContain('model = "MODEL_ID_DARI_DAFTAR_MODELS"');
    expect(section.match(/"model": "MODEL_ID_DARI_DAFTAR_MODELS"/g)).toHaveLength(2);
  });

  it("explains that empty or unavailable discovery means no model may be used", () => {
    const section = text(quickstart(renderCustomer()));
    expect(section).toMatch(/daftar kosong atau gagal dimuat/i);
    expect(section).toMatch(/tidak ada model yang dapat digunakan/i);
    expect(section).toMatch(/jangan kirim request/i);
  });

  it("retains exact canonical IDs in financial recovery and legacy audit, with persisted price and health", () => {
    const html = renderAdmin([persistedModel], [[3, [persistedRequest]], [6, {
      completedWithoutProviderIdentityCount: 1, constraintValidated: false,
      requests: [{ id: "legacy-fixture", createdAt: persistedRequest.createdAt, updatedAt: persistedRequest.updatedAt, model: persistedModel.id }],
    }]]);
    const [card] = modelCards(html);
    expect(card).toContain("Price v7");
    expect(card).toContain("Breaker OPEN");
    expect(html.match(/<td>griphub\/gpt-5\.6-terra(?:<small>|<\/td>)/g)).toHaveLength(2);
    expect(html).toContain("request-fixture");
    expect(html).toContain("BILLING_STATE_UNCONFIRMED");
    expect(html).toContain("Rp 3");
  });

  it.each([undefined, false])("does not offer activation without explicit server admission approval: %s", (activationAllowed) => {
    const html = renderAdmin([{ ...persistedModel, activationAllowed }]);
    const [card] = modelCards(html);
    expect(card).toMatch(/<button\b[^>]*disabled=""/);
    expect(text(modelSection(html))).toMatch(/aktivasi ditahan.*kontrak billing/i);
  });

  it("preserves enable/disable busy states, missing-price guard, MFA, error status and responsive classes", () => {
    const html = renderAdmin([persistedModel, { ...persistedModel, id: "griphub/gpt-5.6-sol", enabled: true }], [[8, "Controlled UI fixture error"], [9, true]]);
    for (const card of modelCards(html, 2)) expect(card).toMatch(/<button\b[^>]*disabled=""/);
    expect(html).toContain("Enable model");
    expect(html).toContain("Disable model");
    expect(html).toContain('role="status"');
    expect(html).toContain("Controlled UI fixture error");
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toContain("xl:grid-cols-[.85fr_1.15fr]");
    const [withoutPrice] = modelCards(renderAdmin([{ ...persistedModel, price: null }]));
    expect(withoutPrice).toContain("Price v—");
    expect(withoutPrice).toMatch(/<button\b[^>]*disabled=""/);
  });

  it("preserves populated customer balances, frozen wallet, key, ledger, busy/error and revoke controls", () => {
    const html = renderCustomer([[1, true], [2, "Controlled customer error"], [6, "key-fixture"], [7, "Fixture revoke reason"]]);
    expect(html).toContain("Rp 123");
    expect(html).toContain("Rp 4");
    expect(html).toContain("Wallet dibekukan");
    expect(html).toContain("Persisted development key");
    expect(html).toContain("fixture-prefix");
    expect(html).toContain("FIXTURE_AUDIT_REASON");
    expect(html).toContain('role="status"');
    expect(html).toContain("Controlled customer error");
    expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*>Memproses…/);
    expect(html).toContain("Konfirmasi cabut");
    expect(html).toContain('value="Fixture revoke reason"');
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain("xl:grid-cols-[1.1fr_.9fr]");
  });

  it("preserves customer empty/error and one-time-secret accessible states", () => {
    const empty = renderCustomer([[0, null], [2, "Overview unavailable"]]);
    expect(empty).toContain("API Balance belum tersedia");
    expect(empty).toContain("Belum ada API key");
    expect(empty).toContain("Belum ada aktivitas ledger");
    expect(empty).toContain("Belum ada pemakaian harian");
    expect(empty).toContain('role="status"');
    const reveal = renderCustomer([[3, "NOT_A_REAL_KEY_UI_FIXTURE"]]);
    expect(reveal).toContain('aria-live="polite"');
    expect(reveal).toContain("NOT_A_REAL_KEY_UI_FIXTURE");
    expect(reveal).toContain("Salin key");
  });
});
