import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveAdmin: vi.fn(),
  modelFindMany: vi.fn(),
  requestFindMany: vi.fn(),
  walletFindMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/active-admin", () => ({ requireActiveAdmin: mocks.requireActiveAdmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiApiModel: { findMany: mocks.modelFindMany },
    aiApiRequest: { findMany: mocks.requestFindMany },
    aiApiWallet: { findMany: mocks.walletFindMany },
  },
}));
vi.mock("@/lib/ai-api/provider-health", () => ({ aiApiHealthMonitorConfig: () => ({}) }));
vi.mock("@/lib/ai-api/admin", () => ({ setAiApiModelAvailability: vi.fn(), settleAiApiRequestByAdmin: vi.fn() }));
vi.mock("@/lib/admin-mfa-service", () => ({ verifyFreshAdminMfa: vi.fn() }));

import { GET as getModels } from "@/app/api/admin/ai-api/models/route";
import { GET as getReconciliation } from "@/app/api/admin/ai-api/reconciliation/route";
import { GET as getKeys } from "@/app/api/admin/ai-api/keys/route";

describe("sensitive AI API admin GET authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "stale-admin", role: "ADMIN" } });
    mocks.requireActiveAdmin.mockResolvedValue(false);
  });

  it("blocks model and pricing reads for a stale deactivated or demoted admin", async () => {
    const response = await getModels();
    expect(response.status).toBe(403);
    expect(mocks.requireActiveAdmin).toHaveBeenCalledWith("stale-admin");
    expect(mocks.modelFindMany).not.toHaveBeenCalled();
  });

  it("blocks reconciliation diagnostics for a stale deactivated or demoted admin", async () => {
    const response = await getReconciliation();
    expect(response.status).toBe(403);
    expect(mocks.requireActiveAdmin).toHaveBeenCalledWith("stale-admin");
    expect(mocks.requestFindMany).not.toHaveBeenCalled();
  });

  it("blocks key and wallet listing for a stale deactivated or demoted admin", async () => {
    const response = await getKeys();
    expect(response.status).toBe(403);
    expect(mocks.requireActiveAdmin).toHaveBeenCalledWith("stale-admin");
    expect(mocks.walletFindMany).not.toHaveBeenCalled();
  });
});
