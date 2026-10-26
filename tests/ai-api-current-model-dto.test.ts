import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), activeAdmin: vi.fn(), findMany: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/active-admin", () => ({ requireActiveAdmin: mocks.activeAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiApiModel: { findMany: mocks.findMany } } }));
vi.mock("@/lib/admin-mfa-service", () => ({ verifyFreshAdminMfa: vi.fn() }));
import { GET } from "@/app/api/admin/ai-api/models/route";
import { AI_API_CATALOG, LEGACY_AI_API_CATALOG } from "@/lib/ai-api/catalog";
const price = { version: 2, upstreamInputMicrosPerMillion: 150_000_000n, upstreamOutputMicrosPerMillion: 300_000_000n, retailInputMicrosPerMillion: 225_000_000n, retailOutputMicrosPerMillion: 450_000_000n, verifiedAt: null };
const rows = [...LEGACY_AI_API_CATALOG, ...AI_API_CATALOG].map((m) => ({ id: `db:${m.id}`, publicId: m.id, provider: m.provider, upstreamModelId: m.upstreamModelId, displayName: `${m.displayName} (${m.provider})`, enabled: false, privateBetaMaxOutputTokens: 8192, providerHealth: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: 0, lastSuccessAt: null, safeReasonCode: "GRIPHUB_BILLING_UNVERIFIED" }, prices: [price] }));
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "admin-fixture", role: "ADMIN" } }); mocks.activeAdmin.mockResolvedValue(true); mocks.findMany.mockResolvedValue(rows); });
describe("admin current-model DTO is provider-neutral and history-safe", () => {
  it("returns only the retained three configured IDs, with canonical neutral labels rather than branded DB names", async () => {
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.models.map((m: { id: string; displayName: string }) => [m.id, m.displayName])).toEqual(AI_API_CATALOG.map((m) => [m.id, m.displayName]));
    expect(body.models.every((m: { activationAllowed?: boolean }) => m.activationAllowed === false)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/\(GRIPHUB\)|\(SEKAI\)/);
    expect(body.models[0].price).toEqual({ version: 2, upstreamInputMicrosPerMillion: "150000000", upstreamOutputMicrosPerMillion: "300000000", retailInputMicrosPerMillion: "225000000", retailOutputMicrosPerMillion: "450000000", verifiedAt: null });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("filters unknown rows and rejects a retired provider masquerading under a retained public ID", async () => {
    mocks.findMany.mockResolvedValue([{ ...rows[4], provider: "SEKAI" }, { ...rows[4], publicId: "unknown/new-provider" }]);
    const body = await (await GET()).json(); expect(body.models).toEqual([]);
  });
  it.each([false, null])("denies stale/inactive admin before sensitive reads: %s", async (allowed) => {
    mocks.activeAdmin.mockResolvedValue(allowed);
    expect((await GET()).status).toBe(403); expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
