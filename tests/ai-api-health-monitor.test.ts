import { afterEach, describe, expect, it, vi } from "vitest";
// Unit-only policy seam for the retained generic lifecycle/health engine.
// Release-policy denial is tested unmocked in ai-api-retirement-*.test.ts.
// This admits only the historical fixture, never a real Griphub configuration.
vi.mock("@/lib/ai-api/provider-policy", () => ({ customerBillingProviderAdmitted: (provider: string) => provider === "SEKAI" }));
import { aiApiHealthMonitorConfig, calculateRequiredPaygBalanceRupiah, healthLeaseUntil, refreshAiApiProviderHealth, type AiApiHealthModel, type AiApiHealthStore } from "@/lib/ai-api/provider-health";
import { probeSekaiProviderHealth, SEKAI_MODELS_URL, SEKAI_QUOTA_URL } from "@/lib/ai-api/providers/sekai-health";

const now = new Date("2026-10-15T15:00:00.000Z");
const closedModel: AiApiHealthModel = { id: "model-1", publicId: "minimax/minimax-m3", provider: "SEKAI", enabled: true, breakerState: "CLOSED", consecutiveFailures: 0, safeReasonCode: null, hasUnresolvedRequests: false };
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

function store(models: AiApiHealthModel[]) {
  return {
    listModels: vi.fn().mockResolvedValue(models),
    requiredProviderBalanceRupiah: vi.fn().mockResolvedValue(0),
    nextPriceBoundary: vi.fn().mockResolvedValue(null),
    renew: vi.fn().mockResolvedValue(true),
    recover: vi.fn().mockResolvedValue(true),
    open: vi.fn().mockResolvedValue(true),
    transientFailure: vi.fn().mockResolvedValue({ changed: true, opened: false }),
  } satisfies AiApiHealthStore;
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("SEKAI provider health probe", () => {
  it("checks PAYG balance/entitlement and model catalog without a billable chat request", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "active", allModels: true, payg: { enabled: true, active: true, balance: 9_973 } }))
      .mockResolvedValueOnce(jsonResponse({ object: "list", data: [{ id: "minimax/minimax-m3" }] }));
    await expect(probeSekaiProviderHealth({ fetch: fetcher, apiKey: "server-only-secret", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: true, modelIds: ["minimax/minimax-m3"], entitledModelIds: null, paygBalanceRupiah: 9_973 });
    expect(fetcher).toHaveBeenNthCalledWith(1, SEKAI_QUOTA_URL, expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, SEKAI_MODELS_URL, expect.objectContaining({ headers: { Authorization: "Bearer server-only-secret" } }));
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ redirect: "error" });
    expect(fetcher.mock.calls.flatMap((call) => [String(call[0])])).not.toContain("/v1/chat/completions");
  });

  it("fails hard for invalid credentials, inactive accounts, or low PAYG balance without leaking provider bodies", async () => {
    const lowBalance = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "active", allModels: true, payg: { enabled: true, active: true, balance: 999 } }))
      .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }));
    await expect(probeSekaiProviderHealth({ fetch: lowBalance, apiKey: "server-only-secret", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_LOW_CREDIT" });
    const inactive = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "inactive", allModels: true, payg: { enabled: true, active: true, balance: 9_973 } }))
      .mockResolvedValueOnce(jsonResponse({ object: "list", data: [] }));
    await expect(probeSekaiProviderHealth({ fetch: inactive, apiKey: "server-only-secret", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_ACCOUNT_INACTIVE" });
    const unauthorized = vi.fn().mockResolvedValueOnce(new Response("private server-only-secret", { status: 401 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(probeSekaiProviderHealth({ fetch: unauthorized, apiKey: "serve...et", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_AUTH" });
  });

  it("preserves hard auth or credit failures when the peer request rejects", async () => {
    const quotaUnauthorized = vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockRejectedValueOnce(new Error("network"));
    await expect(probeSekaiProviderHealth({ fetch: quotaUnauthorized, apiKey: "serve...et", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_AUTH" });

    const modelsCreditFailure = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("credit", { status: 402 }));
    await expect(probeSekaiProviderHealth({ fetch: modelsCreditFailure, apiKey: "serve...et", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_LOW_CREDIT" });
  });

  it("fails closed for malformed response contracts and impossible balances", async () => {
    const cases = [
      { quota: { status: "mystery", allModels: true, payg: { enabled: true, active: true, balance: 9_973 } }, headers: { "content-type": "application/json" } },
      { quota: { status: "active", allModels: true, payg: { enabled: true, active: true, balance: 1e308 } }, headers: { "content-type": "application/json" } },
      { quota: { status: "active", allModels: true, payg: { enabled: true, active: true, balance: 9_973 } }, headers: { "content-type": "text/html" } },
      { quota: { status: "active", allModels: true, payg: { enabled: "true", active: true, balance: 9_973 } }, headers: { "content-type": "application/json" } },
    ];
    for (const testCase of cases) {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(testCase.quota), { status: 200, headers: testCase.headers }))
        .mockResolvedValueOnce(jsonResponse({ object: "list", data: [{ id: closedModel.publicId }] }));
      await expect(probeSekaiProviderHealth({ fetch: fetcher, apiKey: "serve...et", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" });
    }

    const invalidEnvelope = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "active", allModels: true, payg: { enabled: true, active: true, balance: 9_973 } }))
      .mockResolvedValueOnce(jsonResponse({ object: "error", error: { message: "bad" }, data: [{ id: closedModel.publicId }] }));
    await expect(probeSekaiProviderHealth({ fetch: invalidEnvelope, apiKey: "serve...et", minimumPaygBalanceRupiah: 1_000 })).resolves.toEqual({ ok: false, hard: false, reasonCode: "AUTO_HEALTH_INVALID_RESPONSE" });
  });
});

describe("AI API rolling provider health", () => {
  it("keeps the rolling health lease fixed at 300 seconds", () => {
    vi.stubEnv("AI_API_AUTO_HEALTH_WINDOW_SECONDS", "900");
    expect(aiApiHealthMonitorConfig().healthWindowSeconds).toBe(300);
  });

  it("covers the upstream share of all outstanding customer API liabilities", () => {
    expect(calculateRequiredPaygBalanceRupiah(2_983_392_500n, [{ upstreamInput: 1_620_000_000n, upstreamOutput: 3_240_000_000n, retailInput: 2_500_000_000n, retailOutput: 5_000_000_000n }])).toBe(1_934);
  });

  it("uses unbounded intermediate arithmetic and is stable across equivalent rate orderings", () => {
    const minimax = { upstreamInput: 1_620_000_000n, upstreamOutput: 3_240_000_000n, retailInput: 2_500_000_000n, retailOutput: 5_000_000_000n };
    const equalRatio = { upstreamInput: 3_240_000_000n, upstreamOutput: 6_480_000_000n, retailInput: 5_000_000_000n, retailOutput: 10_000_000_000n };
    expect(calculateRequiredPaygBalanceRupiah(6_000_000_000n, [minimax])).toBe(3_888);
    expect(calculateRequiredPaygBalanceRupiah(10_000_000_000n, [minimax, equalRatio])).toBe(6_480);
    expect(calculateRequiredPaygBalanceRupiah(10_000_000_000n, [equalRatio, minimax])).toBe(6_480);
  });

  it("caps health at the next price boundary", async () => {
    expect(healthLeaseUntil(now, new Date("2026-10-15T15:00:01.000Z"))).toEqual(new Date("2026-10-15T15:00:01.000Z"));
    const db = store([closedModel]);
    db.nextPriceBoundary.mockResolvedValue(new Date("2026-10-15T15:00:01.000Z"));
    await refreshAiApiProviderHealth({ now, store: db, probe: async () => ({ ok: true, modelIds: [closedModel.publicId], entitledModelIds: null, paygBalanceRupiah: 9_973 }) });
    expect(db.renew).toHaveBeenCalledWith("model-1", now, new Date("2026-10-15T15:00:01.000Z"));
  });

  it("raises the probe floor to the current provider exposure", async () => {
    const db = store([closedModel]);
    db.requiredProviderBalanceRupiah.mockResolvedValue(2_500);
    const probe = vi.fn().mockResolvedValue({ ok: true, modelIds: [closedModel.publicId], entitledModelIds: null, paygBalanceRupiah: 9_973 });
    await expect(refreshAiApiProviderHealth({ now, store: db, probe })).resolves.toMatchObject({ ok: true, minimumPaygBalanceRupiah: 2_500 });
    expect(probe).toHaveBeenCalledWith(2_500);
  });

  it("renews only enabled closed models after a healthy non-billable probe", async () => {
    const db = store([closedModel, { ...closedModel, id: "model-2", enabled: false }]);
    const result = await refreshAiApiProviderHealth({ now, store: db, probe: async () => ({ ok: true, modelIds: [closedModel.publicId], entitledModelIds: null, paygBalanceRupiah: 9_973 }) });
    expect(result).toMatchObject({ ok: true, checked: 1, renewed: 1, recovered: 0, opened: 0, paygBalanceRupiah: 9_973 });
    expect(db.renew).toHaveBeenCalledWith("model-1", now, new Date("2026-10-15T15:05:00.000Z"));
    expect(db.recover).not.toHaveBeenCalled();
  });

  it("auto-recovers only monitor-opened models with no unresolved billing", async () => {
    const monitorOpen = { ...closedModel, breakerState: "OPEN" as const, safeReasonCode: "AUTO_HEALTH_REPEATED_FAILURE", consecutiveFailures: 3 };
    const financialOpen = { ...monitorOpen, id: "model-2", publicId: "gemini/gemini-3.8-flash-high", safeReasonCode: "CHARGE_EXCEEDS_RESERVATION" };
    const unresolved = { ...monitorOpen, id: "model-3", publicId: "cx/gpt-5.6-sol", hasUnresolvedRequests: true };
    const db = store([monitorOpen, financialOpen, unresolved]);
    const result = await refreshAiApiProviderHealth({ now, store: db, probe: async () => ({ ok: true, modelIds: [monitorOpen.publicId, financialOpen.publicId, unresolved.publicId], entitledModelIds: null, paygBalanceRupiah: 9_973 }) });
    expect(result).toMatchObject({ ok: true, checked: 1, renewed: 0, recovered: 1, opened: 0, skipped: 2 });
    expect(db.recover).toHaveBeenCalledWith("model-1", now, new Date("2026-10-15T15:05:00.000Z"));
    expect(db.recover).not.toHaveBeenCalledWith("model-2", expect.anything(), expect.anything());
    expect(db.recover).not.toHaveBeenCalledWith("model-3", expect.anything(), expect.anything());
  });

  it("opens immediately on hard failure and counts transient failures before opening", async () => {
    const hardStore = store([closedModel]);
    await expect(refreshAiApiProviderHealth({ now, store: hardStore, probe: async () => ({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_LOW_CREDIT" }) })).resolves.toMatchObject({ ok: false, opened: 1, reasonCode: "AUTO_HEALTH_LOW_CREDIT" });
    expect(hardStore.open).toHaveBeenCalledWith("model-1", "AUTO_HEALTH_LOW_CREDIT", now);

    const transientStore = store([closedModel]);
    transientStore.transientFailure.mockResolvedValue({ changed: true, opened: true });
    await expect(refreshAiApiProviderHealth({ now, store: transientStore, probe: async () => ({ ok: false, hard: false, reasonCode: "AUTO_HEALTH_NETWORK" }) })).resolves.toMatchObject({ ok: false, transientFailures: 1, opened: 1 });
  });

  it("reports an already-open monitor breaker as degraded while its model is still missing", async () => {
    const monitorOpen = { ...closedModel, breakerState: "OPEN" as const, safeReasonCode: "AUTO_HEALTH_MODEL_MISSING", consecutiveFailures: 1 };
    const db = store([monitorOpen]);
    await expect(refreshAiApiProviderHealth({ now, store: db, probe: async () => ({ ok: true, modelIds: [], entitledModelIds: null, paygBalanceRupiah: 9_973 }) })).resolves.toMatchObject({ ok: false, checked: 1, recovered: 0, reasonCode: "AUTO_HEALTH_MODEL_MISSING" });
    expect(db.recover).not.toHaveBeenCalled();
  });
});
