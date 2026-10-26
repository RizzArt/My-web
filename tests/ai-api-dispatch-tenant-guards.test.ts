import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
// Unit-only historical-engine admission, never a production/provider override.
// The unmocked retirement suite continues to deny all seven actual API models.
vi.mock("@/lib/ai-api/provider-policy", () => ({ customerBillingProviderAdmitted: (provider: string) => provider === "SEKAI" }));
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/ai-api/provider-health", () => ({ acquireAiApiProviderAdmissionLock: mocks.lock }));
import { markAiApiDispatching } from "@/lib/ai-api/service";
const now = new Date("2026-10-25T12:00:00Z");
let key: ReturnType<typeof makeKey>;
let tx: ReturnType<typeof makeTx>;
const request = () => ({ id: "tenant-request", status: "RESERVED", walletId: "tenant-wallet", apiKeyId: "tenant-key", modelId: "tenant-model", model: { provider: "SEKAI", enabled: true, providerHealth: { breakerState: "CLOSED", healthyUntil: new Date("2099-01-01") } } });
function makeKey() { return { id: "tenant-key", walletId: "tenant-wallet", status: "ACTIVE", expiresAt: null as Date | null, wallet: { id: "tenant-wallet", userId: "tenant-user", isFrozen: false, user: { isActive: true } } }; }
function makeTx() { return {
  $queryRaw: vi.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => [{ id: String(values[0]) }]),
  aiApiRequest: { findUnique: vi.fn(async () => request()), count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 1 })) },
  aiApiKey: { findUnique: vi.fn(async () => key) },
}; }
beforeEach(() => { vi.clearAllMocks(); key = makeKey(); tx = makeTx(); mocks.transaction.mockImplementation(async (work) => work(tx)); });

describe("last pre-dispatch tenant checkpoint", () => {
  it.each(["40001", "40P01"])("retries only a known raw-query transaction conflict: %s", async (sqlstate) => {
    const conflict = new Prisma.PrismaClientKnownRequestError("fixture conflict", { code: "P2010", clientVersion: "fixture", meta: { code: sqlstate } });
    tx.$queryRaw.mockRejectedValueOnce(conflict);
    await expect(markAiApiDispatching("tenant-request", now)).resolves.toBeUndefined();
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(tx.aiApiRequest.updateMany).toHaveBeenCalledOnce();
  });
  it("rechecks authority after a serialization retry instead of reusing active credentials", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("fixture conflict", { code: "P2010", clientVersion: "fixture", meta: { code: "40001" } });
    tx.$queryRaw.mockImplementationOnce(async () => { key.status = "REVOKED"; throw conflict; });
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toMatchObject({ code: "invalid_api_key" });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });
  it("bounds raw serialization retry attempts and leaves the request unclaimed", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("fixture conflict", { code: "P2010", clientVersion: "fixture", meta: { code: "40001" } });
    tx.$queryRaw.mockRejectedValue(conflict);
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toBe(conflict);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });
  it("does not retry an unrelated raw-query error", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("fixture missing relation", { code: "P2010", clientVersion: "fixture", meta: { code: "42P01" } });
    tx.$queryRaw.mockRejectedValue(error);
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toBe(error);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });

  it("claims an active tenant only after locking wallet, key, then owner", async () => {
    await expect(markAiApiDispatching("tenant-request", now)).resolves.toBeUndefined();
    const sql = tx.$queryRaw.mock.calls.map(([query]) => query.join("?"));
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain('FROM "AiApiWallet"');
    expect(sql[1]).toContain('FROM "AiApiKey"');
    expect(sql[2]).toContain('FROM "User"');
    expect(sql.every((query) => query.includes("FOR UPDATE"))).toBe(true);
    expect(tx.aiApiKey.findUnique).toHaveBeenCalledOnce();
    expect(tx.aiApiRequest.updateMany).toHaveBeenCalledOnce();
  });
  it.each(["frozen", "banned", "expired", "wrong-wallet"])("vetoes changed tenant authority after reservation: %s", async (state) => {
    if (state === "frozen") key.wallet.isFrozen = true;
    if (state === "banned") key.wallet.user.isActive = false;
    if (state === "expired") key.expiresAt = now;
    if (state === "wrong-wallet") key.walletId = "another-wallet";
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toMatchObject({ code: "invalid_api_key", requestStatus: "RESERVED" });
    expect(tx.aiApiKey.findUnique).toHaveBeenCalledOnce();
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });
  it.each([1, 2])("fails closed when authority row %s disappears while checking", async (missing) => {
    let index = 0;
    tx.$queryRaw.mockImplementation(async (_sql, ...values) => index++ === missing ? [] : [{ id: String(values[0]) }]);
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toMatchObject({ code: "invalid_api_key" });
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });

  it("uses a fresh default clock after waiting for admission before accepting an expiring key", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    key.expiresAt = new Date(now.getTime() + 1_000);
    mocks.lock.mockImplementationOnce(async () => { vi.setSystemTime(new Date(now.getTime() + 2_000)); });
    try {
      await expect(markAiApiDispatching("tenant-request")).rejects.toMatchObject({ code: "invalid_api_key", requestStatus: "RESERVED" });
      expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("fails closed if the wallet authority row cannot be locked", async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toMatchObject({ code: "invalid_api_key", requestStatus: "RESERVED" });
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });

  it("vetoes a key revoked after reservation without claiming DISPATCHING", async () => {
    key.status = "REVOKED";
    await expect(markAiApiDispatching("tenant-request", now)).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401, requestStatus: "RESERVED" });
    expect(tx.aiApiRequest.updateMany).not.toHaveBeenCalled();
  });
});
