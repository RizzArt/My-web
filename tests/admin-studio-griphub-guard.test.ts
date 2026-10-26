import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    studioModelConfig: { findUniqueOrThrow: mocks.findUniqueOrThrow, update: mocks.update },
    auditLog: { create: mocks.auditCreate },
  },
}));
vi.mock("@/lib/studio/service", () => ({ creditStudioUser: vi.fn() }));

import { PATCH } from "@/app/api/admin/studio/route";

describe("admin Studio Griphub activation guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects enabling a Griphub image row before any mutation", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.findUniqueOrThrow.mockResolvedValue({ provider: "GRIPHUB", model: "gpt-image" });

    const response = await PATCH(new Request("https://riezz99.biz.id/api/admin/studio", {
      method: "PATCH",
      body: JSON.stringify({ action: "model", id: "studio_griphub_gpt_image", model: "gpt-image", isEnabled: true, creditCostPerImage: 17 }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: expect.stringContaining("GRIPHUB image belum dapat diaktifkan") }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
