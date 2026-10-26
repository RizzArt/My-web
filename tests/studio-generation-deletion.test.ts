import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  referenceFindFirst: vi.fn(),
  referenceUpdate: vi.fn(),
  referenceDelete: vi.fn(),
  deleteStudioFile: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, studioGenerationOutput: { deleteMany: mocks.deleteMany } } }));
vi.mock("@/lib/studio/storage", () => ({ deleteStudioFile: mocks.deleteStudioFile }));

const read = (file: string) => {
  const target = path.join(process.cwd(), file);
  return existsSync(target) ? readFileSync(target, "utf8") : "";
};

async function deleteRoute() {
  try {
    return await import("@/app/api/studio/generations/[generationId]/route");
  } catch {
    return null;
  }
}

function request() {
  return new Request("https://example.test/api/studio/generations/gen-1", { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.count.mockResolvedValue(0);
  mocks.referenceFindFirst.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    studioGeneration: { findFirst: mocks.findFirst, count: mocks.count, update: mocks.update },
    studioGenerationOutput: { deleteMany: mocks.deleteMany },
    studioReference: { findFirst: mocks.referenceFindFirst, update: mocks.referenceUpdate, delete: mocks.referenceDelete },
  }));
});

describe("AI Studio generation deletion", () => {
  it("adds an additive soft-delete field and filters deleted history", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read("prisma/migrations/20261012235000_studio_generation_deletion/migration.sql");
    const pendingMigration = read("prisma/migrations/20261014050000_studio_deletion_pending_hardening/migration.sql");
    const historyRoute = read("src/app/api/studio/generations/route.ts");
    expect(schema).toMatch(/deletedAt\s+DateTime\?/);
    expect(schema).toContain("deletionPendingAt");
    expect(migration).toContain('ADD COLUMN "deletedAt" TIMESTAMP(3)');
    expect(migration).not.toContain('ADD COLUMN "deletionPendingAt" TIMESTAMP(3)');
    expect(pendingMigration).toContain('ADD COLUMN "deletionPendingAt" TIMESTAMP(3)');
    expect(historyRoute).toContain("deletedAt: null");
  });

  it("deletes only an owned terminal generation, removes output rows and files, and preserves financial state", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "gen-1",
      status: "COMPLETED",
      deletedAt: null,
      outputs: [{ storageKey: "output-11111111-1111-4111-8111-111111111111.png" }, { storageKey: "output-22222222-2222-4222-8222-222222222222.webp" }],
    });
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "gen-1", userId: "user-1" } }));
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { generationId: "gen-1" } });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "gen-1" },
      data: expect.objectContaining({ deletedAt: expect.any(Date), deletionPendingAt: null, prompt: "[deleted by user]", referenceStorageKey: null }),
    }));
    expect(mocks.deleteStudioFile).toHaveBeenCalledTimes(2);
    expect(mocks.deleteStudioFile.mock.invocationCallOrder[1]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
  });

  it("deletes a failed generation with no output file", async () => {
    mocks.findFirst.mockResolvedValue({ id: "gen-1", status: "FAILED", deletedAt: null, outputs: [] });
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    expect(mocks.deleteStudioFile).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { generationId: "gen-1" } });
  });

  it("returns 404 for another user's generation without deleting anything", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteStudioFile).not.toHaveBeenCalled();
  });

  it("rejects pending or processing generations", async () => {
    mocks.findFirst.mockResolvedValue({ id: "gen-1", status: "PROCESSING", deletedAt: null, outputs: [] });
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("retries durable file cleanup for an already deleted generation", async () => {
    mocks.findFirst.mockResolvedValue({ id: "gen-1", status: "COMPLETED", deletedAt: new Date(), outputs: [{ storageKey: "output-11111111-1111-4111-8111-111111111111.png" }] });
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteStudioFile).toHaveBeenCalledWith("output-11111111-1111-4111-8111-111111111111.png");
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { generationId: "gen-1" } });
  });

  it("keeps output metadata for a later retry when file deletion fails", async () => {
    mocks.findFirst.mockResolvedValue({ id: "gen-1", status: "COMPLETED", deletedAt: null, outputs: [{ storageKey: "output-11111111-1111-4111-8111-111111111111.png" }] });
    mocks.deleteStudioFile.mockRejectedValueOnce(new Error("permission denied"));
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { deletionPendingAt: expect.any(Date) } }));
    expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes an unshared reference blob and row but keeps shared references", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "gen-1",
      status: "FAILED",
      deletedAt: null,
      deletionPendingAt: null,
      referenceStorageKey: "reference-33333333-3333-4333-8333-333333333333.png",
      outputs: [],
    });
    mocks.referenceFindFirst.mockResolvedValue({ id: "ref-1", deletionPendingAt: null });
    const route = await deleteRoute();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.referenceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ref-1" },
      data: { deletionPendingAt: expect.any(Date) },
    }));
    expect(mocks.deleteStudioFile).toHaveBeenCalledWith("reference-33333333-3333-4333-8333-333333333333.png");
    expect(mocks.referenceDelete).toHaveBeenCalledWith({ where: { id: "ref-1" } });

    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.count.mockResolvedValue(1);
    mocks.referenceFindFirst.mockResolvedValue({ id: "ref-1", deletionPendingAt: null });
    mocks.findFirst.mockResolvedValue({
      id: "gen-1",
      status: "FAILED",
      deletedAt: null,
      deletionPendingAt: null,
      referenceStorageKey: "reference-33333333-3333-4333-8333-333333333333.png",
      outputs: [],
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      studioGeneration: { findFirst: mocks.findFirst, count: mocks.count, update: mocks.update },
      studioGenerationOutput: { deleteMany: mocks.deleteMany },
      studioReference: { findFirst: mocks.referenceFindFirst, update: mocks.referenceUpdate, delete: mocks.referenceDelete },
    }));
    const sharedResponse = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(sharedResponse.status).toBe(200);
    expect(mocks.deleteStudioFile).not.toHaveBeenCalledWith("reference-33333333-3333-4333-8333-333333333333.png");
    expect(mocks.referenceDelete).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    const route = await deleteRoute();
    expect(route).not.toBeNull();
    const response = await route!.DELETE(request(), { params: Promise.resolve({ generationId: "gen-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("keeps deployment additive and verifies financial aggregates stay unchanged", () => {
    const deploy = read("deployment/ai-studio-deploy.sh");
    expect(deploy).toContain('"20261012235000_studio_generation_deletion"');
    expect(deploy).toContain('"20261014050000_studio_deletion_pending_hardening"');
    expect(deploy).toContain("financial_snapshot");
    expect(deploy).toContain('before_financial="$(financial_snapshot "$release")"');
    expect(deploy).toContain('after_financial="$(financial_snapshot "$release")"');
    expect(deploy).toContain('[ "$before_financial" = "$after_financial" ]');
    expect(deploy).not.toContain("prisma.studioCreditTopUp.count()");
    expect(deploy).toContain('assert_delete_guard "$SMOKE_URL" "/api/studio/generations/smoke-generation"');
    expect(deploy).toContain('runuser -u harnet -- env -u DATABASE_URL');
    expect(deploy).toContain('stat -c \'%U:%G %a\' "$release"');
    expect(deploy).not.toContain("topUps !== 0");
  });

  it("guards both automatic and manual rollback against incompatible releases", () => {
    const deploy = read("deployment/ai-studio-deploy.sh");
    expect(deploy).toContain("release_supports_generation_soft_delete");
    expect(deploy).toContain("assert_effective_release");
    expect(deploy).toContain('grep -Fxq "WorkingDirectory=$previous_release"');
    expect(deploy).toContain('assert_effective_release "$previous_release"');
    expect(deploy).toContain('assert_effective_release "$2"');
    expect(deploy).not.toContain("rollback_app 1");
    expect(deploy).toContain("ROLLBACK_FAILED");
    expect(deploy).toContain("target rollback tidak mendukung soft-delete generation");
  });

  it("stages candidate validation under the service account instead of root", () => {
    const stage = read("deployment/stage-ai-studio-release.sh");
    expect(stage).toContain('runuser -u harnet -- node "$seal_dir/deployment/check-ai-studio-env.mjs"');
  });

  it("denies downloads as soon as a generation is soft-deleted and only suppresses missing-file cleanup", () => {
    const outputRoute = read("src/app/api/studio/outputs/[outputId]/route.ts");
    const storage = read("src/lib/studio/storage.ts");
    expect(outputRoute).toContain("generation: { userId: session.user.id, deletedAt: null }");
    expect(storage).toContain('code !== "ENOENT"');
    expect(storage).not.toContain("await unlink(target).catch(() => undefined)");
  });

  it("adds a confirmed 44px delete action for successful and failed history", () => {
    const source = read("src/components/studio-page.tsx");
    const css = read("src/app/globals.css");
    expect(source).toContain("async function deleteGeneration(item: Generation)");
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("window.confirm");
    expect(source).toContain("Hapus generation");
    expect(source).toContain("deletingId");
    expect(source).toContain("deletedIdsRef");
    expect(source).toContain("historyHeadingRef");
    expect(source).toContain("aria-busy={deletingId === item.id}");
    expect(source).toContain("studio-pro-delete");
    expect(css).toContain(".studio-pro-delete");
    expect(css).toMatch(/\.studio-pro-delete[^}]*min-height:\s*44px/);
  });
});
