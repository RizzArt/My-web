import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { uniqueCategorySlug } from "@/lib/category-slug";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  categoryUpdate: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, category: { update: mocks.categoryUpdate } } }));

const createRoute = readFileSync(new URL("../src/app/api/admin/categories/route.ts", import.meta.url), "utf8");
const updateRoute = readFileSync(new URL("../src/app/api/admin/categories/[categoryId]/route.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/components/category-manager.tsx", import.meta.url), "utf8");

describe("category management", () => {
  it("generates a normalized slug from the category name", async () => {
    const tx = { category: { findFirst: async () => null } } as never;
    await expect(uniqueCategorySlug(tx, "Ebook Premium")).resolves.toBe("ebook-premium");
  });

  it("adds a numeric suffix when generated slugs are already used", async () => {
    const used = new Set(["ebook-premium", "ebook-premium-2"]);
    const tx = { category: { findFirst: async ({ where }: { where: { slug: string } }) => used.has(where.slug) ? { id: where.slug } : null } } as never;
    await expect(uniqueCategorySlug(tx, "Ebook Premium")).resolves.toBe("ebook-premium-3");
  });

  it("keeps category API input server-owned and admin-only", () => {
    expect(createRoute).toContain("name: z.string()");
    expect(createRoute).toContain("uniqueCategorySlug");
    expect(createRoute).not.toContain("slug: z.string()");
    expect(createRoute).not.toContain("description: z.string()");
    expect(updateRoute).toContain("session?.user.role === \"ADMIN\"");
    expect(updateRoute).toContain("data: { name: parsed.data.name }");
    expect(updateRoute).not.toContain("slug: z.string()");
    expect(updateRoute).not.toContain("description: z.string()");
  });

  it("creates a category for admins using only the name", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "ADMIN" } });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      category: {
        findFirst: async () => null,
        create: async ({ data }: { data: { name: string; slug: string } }) => ({ id: "cat-1", ...data, description: null }),
      },
    }));
    const { POST } = await import("@/app/api/admin/categories/route");
    const response = await POST(new Request("http://localhost/api/admin/categories", { method: "POST", body: JSON.stringify({ name: "Ebook Premium" }) }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ category: { name: "Ebook Premium", slug: "ebook-premium" } });
  });

  it("rejects category creation for non-admins", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "SELLER" } });
    const { POST } = await import("@/app/api/admin/categories/route");
    const response = await POST(new Request("http://localhost/api/admin/categories", { method: "POST", body: JSON.stringify({ name: "Ebook Premium" }) }));
    expect(response.status).toBe(403);
  });

  it("updates a category without requiring a client slug", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "ADMIN" } });
    mocks.categoryUpdate.mockResolvedValue({ id: "cat-1", name: "Ebook Baru", slug: "ebook-premium" });
    const { PATCH } = await import("@/app/api/admin/categories/[categoryId]/route");
    const response = await PATCH(new Request("http://localhost/api/admin/categories/cat-1", { method: "PATCH", body: JSON.stringify({ name: "Ebook Baru" }) }), { params: Promise.resolve({ categoryId: "cat-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.categoryUpdate).toHaveBeenCalledWith({ where: { id: "cat-1" }, data: { name: "Ebook Baru" } });
  });

  it("keeps the category form limited to name and action controls", () => {
    expect(manager).toContain("Nama Kategori");
    expect(manager).toContain("Tambah Kategori");
    expect(manager).toContain("Simpan Perubahan");
    expect(manager).not.toContain("Slug");
    expect(manager).not.toContain("Deskripsi");
  });
});
