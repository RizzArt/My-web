import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_API_CATALOG, LEGACY_AI_API_CATALOG } from "@/lib/ai-api/catalog";
import { refreshAiApiProviderHealth, type AiApiHealthStore } from "@/lib/ai-api/provider-health";
const known = [...LEGACY_AI_API_CATALOG, ...AI_API_CATALOG].map(({ id, provider }) => ({ publicId: id, provider }));
const now = new Date("2026-10-25T05:00:00Z");
function storeFor(provider: string, publicId: string, breakerState: "CLOSED" | "OPEN") {
  return {
    listModels: vi.fn(async () => [{ id: "model-fixture", publicId, provider, enabled: true, breakerState, consecutiveFailures: 0, safeReasonCode: breakerState === "OPEN" ? "AUTO_HEALTH_LOW_CREDIT" : null, hasUnresolvedRequests: false }]),
    requiredProviderBalanceRupiah: vi.fn(async () => 0), nextPriceBoundary: vi.fn(async () => null),
    renew: vi.fn(async () => true), recover: vi.fn(async () => true), open: vi.fn(async () => true), transientFailure: vi.fn(async () => ({ changed: true, opened: false })),
  } satisfies AiApiHealthStore;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("AI API health monitor cannot restore retired or unverified providers", () => {
  it.each(known.flatMap((m) => (["CLOSED", "OPEN"] as const).map((state) => ({ ...m, state }))))("skips provider=$provider model=$publicId state=$state even when injected probe would pass", async ({ provider, publicId, state }) => {
    const store = storeFor(provider, publicId, state);
    const probe = vi.fn(async () => ({ ok: true as const, modelIds: [publicId], entitledModelIds: null, paygBalanceRupiah: 100_000 }));
    await expect(refreshAiApiProviderHealth({ now, store, probe })).resolves.toMatchObject({ ok: true, checked: 0, renewed: 0, recovered: 0, opened: 0, skipped: 1 });
    expect(probe).not.toHaveBeenCalled(); expect(store.requiredProviderBalanceRupiah).not.toHaveBeenCalled(); expect(store.nextPriceBoundary).not.toHaveBeenCalled();
    for (const write of [store.renew, store.recover, store.open, store.transientFailure]) expect(write).not.toHaveBeenCalled();
  });
  it("never reads/calls the Studio credential's upstream endpoints in the default API probe path", async () => {
    vi.stubEnv("SEKAI_API_KEY", "isolated-studio-fixture-not-live");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "active", allModels: true, payg: { enabled: true, active: true, balance: 100_000 }, object: "list", data: known.map((m) => ({ id: m.publicId })) }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const store = storeFor("SEKAI", "minimax/minimax-m3", "CLOSED");
    await expect(refreshAiApiProviderHealth({ now, store })).resolves.toMatchObject({ checked: 0, renewed: 0, recovered: 0 });
    expect(fetcher).not.toHaveBeenCalled(); expect(store.renew).not.toHaveBeenCalled(); expect(process.env.SEKAI_API_KEY).toBe("isolated-studio-fixture-not-live");
  });
  it("fails closed for an unknown provider even when it copies a known model ID", async () => {
    const store = storeFor("UNREVIEWED", "griphub/minimax-m3", "CLOSED"); const probe = vi.fn();
    await expect(refreshAiApiProviderHealth({ now, store, probe })).resolves.toMatchObject({ checked: 0, renewed: 0 });
    expect(probe).not.toHaveBeenCalled();
  });
});
