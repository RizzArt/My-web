import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), actor: vi.fn(), probe: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, user: { findUnique: mocks.actor } } }));
vi.mock("@/lib/ai-api/providers/sekai-health", () => ({ probeSekaiProviderHealth: mocks.probe }));
import { setAiApiModelAvailability } from "@/lib/ai-api/admin";
import { AI_API_CATALOG, LEGACY_AI_API_CATALOG, catalogModel } from "@/lib/ai-api/catalog";
const ids = [...LEGACY_AI_API_CATALOG, ...AI_API_CATALOG].map((m) => m.id);
const base = { actorId: "admin-fixture", expectedPriceVersion: 2, verificationReference: "retirement-fixture", reason: "Disable safely, never activate" };
let tx: ReturnType<typeof makeTx>;
function makeTx() {
  return {
    $queryRaw: vi.fn(async () => [{ locked: true }]),
    user: { findUnique: mocks.actor },
    studioGeneration: { count: vi.fn(async () => 0) },
    aiApiRequest: { count: vi.fn(async () => 0) },
    aiApiModel: { findUnique: vi.fn(async ({ where }) => { const c = catalogModel(where.publicId)!; return { id: "db-model", publicId: c.id, provider: c.provider, upstreamModelId: c.upstreamModelId, maxInputTokens: c.providerMaxInputTokens, maxOutputTokens: c.providerMaxOutputTokens, privateBetaMaxOutputTokens: c.privateBetaMaxOutputTokens, maxRequestBytes: c.maxRequestBytes, providerHealth: { breakerState: "CLOSED" }, prices: [{ version: 2, verifiedAt: new Date() }] }; }), update: vi.fn() },
    aiApiProviderHealth: { update: vi.fn() },
    aiApiWallet: { aggregate: vi.fn(async () => ({ _sum: { availableMicros: 0n, reservedMicros: 0n } })) },
    aiApiPriceVersion: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn() },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SEKAI_API_KEY", "isolated-studio-key-fixture-not-live");
  mocks.actor.mockResolvedValue({ role: "ADMIN", isActive: true });
  mocks.probe.mockResolvedValue({ ok: true, modelIds: ids, entitledModelIds: null, paygBalanceRupiah: 10_000 });
  tx = makeTx(); mocks.transaction.mockImplementation(async (work: (value: typeof tx) => unknown) => work(tx));
});
afterEach(() => vi.unstubAllEnvs());
describe("AI API provider retirement admin boundary", () => {
  it.each(ids)("cannot enable a retired or financially unverified provider before any transaction/probe: %s", async (publicId) => {
    await expect(setAiApiModelAvailability({ ...base, publicId, enabled: true })).rejects.toThrow(/dihentikan|belum/i);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.probe).not.toHaveBeenCalled();
    expect(tx.aiApiModel.update).not.toHaveBeenCalled(); expect(tx.aiApiProviderHealth.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("can protectively disable a retained model even when its price is unverified", async () => {
    const original = tx.aiApiModel.findUnique.getMockImplementation()!;
    tx.aiApiModel.findUnique.mockImplementation(async (input) => { const row = await original(input); row.prices = [{ version: 2, verifiedAt: null as unknown as Date }]; return row; });
    await expect(setAiApiModelAvailability({ ...base, publicId: "griphub/minimax-m3", enabled: false })).resolves.toEqual({ id: "griphub/minimax-m3", enabled: false, breakerState: "OPEN" });
    expect(tx.aiApiModel.update).toHaveBeenCalledWith({ where: { id: "db-model" }, data: { enabled: false } });
    expect(tx.aiApiProviderHealth.update).toHaveBeenCalledWith({ where: { modelId: "db-model" }, data: expect.objectContaining({ breakerState: "OPEN", healthyUntil: null }) });
    expect(mocks.probe).not.toHaveBeenCalled(); expect(tx.aiApiWallet.aggregate).not.toHaveBeenCalled();
  });
  it.each([{ role: "CUSTOMER", isActive: true }, { role: "ADMIN", isActive: false }])("still rejects an inactive or demoted actor during protective disable: %j", async (actor) => {
    mocks.actor.mockResolvedValue(actor);
    await expect(setAiApiModelAvailability({ ...base, publicId: "minimax/minimax-m3", enabled: false })).rejects.toThrow(/Admin/);
    expect(tx.aiApiModel.update).not.toHaveBeenCalled(); expect(tx.aiApiProviderHealth.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
