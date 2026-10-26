import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindMany: vi.fn(),
  requestCount: vi.fn(),
  requestFindMany: vi.fn(),
  queryRaw: vi.fn(),
  requireActiveAdmin: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/active-admin", () => ({ requireActiveAdmin: mocks.requireActiveAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    aiApiRequest: { count: mocks.requestCount, findMany: mocks.requestFindMany },
    $queryRaw: mocks.queryRaw,
  },
}));

import { GET } from "@/app/api/admin/ai-api/overview/route";

describe("admin AI API overview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveAdmin.mockResolvedValue(true);
  });

  it("rejects unauthenticated and non-admin sessions before reading integrity data", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const unauthenticated = await GET();
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toContain("no-store");

    mocks.auth.mockResolvedValueOnce({ user: { id: "customer-1", role: "CUSTOMER" } });
    const forbidden = await GET();
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toContain("no-store");

    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.requestCount).not.toHaveBeenCalled();
    expect(mocks.requestFindMany).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a stale ADMIN session after deactivation or demotion before sensitive reads", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "stale-admin", role: "ADMIN" } });
    mocks.requireActiveAdmin.mockResolvedValue(false);

    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.requireActiveAdmin).toHaveBeenCalledWith("stale-admin");
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.requestCount).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns bounded read-only legacy integrity evidence to an admin", async () => {
    const createdAt = new Date("2026-10-01T01:02:03.000Z");
    const updatedAt = new Date("2026-10-02T04:05:06.000Z");
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.userFindMany.mockResolvedValue([
      { id: "user-1", email: "user@example.test", name: "User", role: "CUSTOMER", aiApiWallet: { availableMicros: 100n, reservedMicros: 25n, isFrozen: false, keys: [{ id: "key-1" }] } },
    ]);
    mocks.requestCount.mockResolvedValue(2);
    mocks.queryRaw
      .mockResolvedValueOnce([{ count: 4n }])
      .mockResolvedValueOnce([{ id: "request-1", createdAt, updatedAt, modelPublicId: "minimax/test-model" }])
      .mockResolvedValueOnce([{ convalidated: false, contype: "c", definition: `CHECK ((status <> 'COMPLETED'::"AiApiRequestStatus") OR ("providerRequestId" IS NOT NULL))` }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
    expect(body).toEqual(expect.objectContaining({
      currentUserId: "admin-1",
      unresolvedRequestCount: 2,
      legacyIntegrity: {
        completedWithoutProviderIdentityCount: 4,
        constraintValidated: false,
        requests: [{ id: "request-1", createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(), model: "minimax/test-model" }],
      },
    }));
    expect(body.users[0].wallet).toEqual({ availableMicros: "100", reservedMicros: "25", isFrozen: false, activeKeyCount: 1 });
  });

  it("reports an absent constraint as unknown without exposing extra request fields", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.userFindMany.mockResolvedValue([]);
    mocks.requestCount.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.legacyIntegrity).toEqual({
      completedWithoutProviderIdentityCount: 0,
      constraintValidated: null,
      requests: [],
    });
  });

  it("reports a matching validated constraint as validated without a NOT VALID suffix", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.userFindMany.mockResolvedValue([]);
    mocks.requestCount.mockResolvedValue(0);
    mocks.queryRaw
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ convalidated: true, contype: "c", definition: `CHECK ((status <> 'COMPLETED'::"AiApiRequestStatus") OR ("providerRequestId" IS NOT NULL))` }]);

    const response = await GET();
    const body = await response.json();
    expect(body.legacyIntegrity.constraintValidated).toBe(true);
  });
});
