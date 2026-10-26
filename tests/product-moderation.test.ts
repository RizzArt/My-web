import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moderateSellerProduct } from "@/lib/product-moderation";

const routeSource = readFileSync(new URL("../src/app/api/admin/products/[productId]/moderation/route.ts", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("../src/lib/product-moderation.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/components/product-moderation-actions.tsx", import.meta.url), "utf8");

function transaction(initialStatus: "PENDING_REVIEW" | "REJECTED" = "PENDING_REVIEW", sellerId: string | null = "seller-1") {
  const calls: { audit?: Record<string, unknown>; notification?: Record<string, unknown> } = {};
  const current = { id: "product-1", name: "Product", sellerId, moderationStatus: initialStatus, seller: sellerId ? { userId: "seller-user-1" } : null };
  const tx = {
    product: {
      findUnique: async () => current,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...current, ...data }),
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { calls.audit = data; return data; } },
    notification: { create: async ({ data }: { data: Record<string, unknown> }) => { calls.notification = data; return data; } },
  } as never;
  return { tx, calls };
}

describe("seller product moderation", () => {
  it("approves a pending seller product", async () => {
    const { tx } = transaction();
    await expect(moderateSellerProduct(tx, { productId: "product-1", actorId: "admin-1", status: "APPROVED" })).resolves.toMatchObject({ moderationStatus: "APPROVED", isPublished: true });
  });

  it("clears a previous rejection reason on approval", async () => {
    const { tx } = transaction();
    await expect(moderateSellerProduct(tx, { productId: "product-1", actorId: "admin-1", status: "APPROVED" })).resolves.toMatchObject({ rejectionReason: null });
  });

  it("creates an audit log and seller notification for approval", async () => {
    const { tx, calls } = transaction();
    await moderateSellerProduct(tx, { productId: "product-1", actorId: "admin-1", status: "APPROVED" });
    expect(calls.audit).toMatchObject({ actorId: "admin-1", action: "PRODUCT_APPROVED", entityId: "product-1" });
    expect(calls.notification).toMatchObject({ userId: "seller-user-1", type: "PRODUCT_MODERATION", link: "/seller/products/product-1/edit" });
  });

  it("rejects with a required reason and notifies the seller", async () => {
    const { tx, calls } = transaction();
    await expect(moderateSellerProduct(tx, { productId: "product-1", actorId: "admin-1", status: "REJECTED", rejectionReason: "Perbaiki deskripsi" })).resolves.toMatchObject({ moderationStatus: "REJECTED", isPublished: false, rejectionReason: "Perbaiki deskripsi" });
    expect(calls.audit).toMatchObject({ action: "PRODUCT_REJECTED", metadata: { rejectionReason: "Perbaiki deskripsi" } });
    expect(calls.notification).toMatchObject({ userId: "seller-user-1" });
  });

  it("rejects moderation for a platform product", async () => {
    const { tx } = transaction("PENDING_REVIEW", null);
    await expect(moderateSellerProduct(tx, { productId: "product-1", actorId: "admin-1", status: "APPROVED" })).rejects.toThrow("produk seller");
  });

  it("rejects moderation when the product is not pending", async () => {
    const { tx } = transaction("REJECTED");
    await expect(moderateSellerProduct(tx, { productId: "product-1", actorId: "admin-1", status: "APPROVED" })).rejects.toThrow("menunggu moderation");
  });

  it("keeps admin-only authorization in the API route", () => {
    expect(routeSource).toContain('session?.user.role !== "ADMIN"');
    expect(routeSource).toContain("moderateSellerProduct");
  });

  it("does not allow a seller session to approve", () => {
    expect(routeSource).toContain('return NextResponse.json({ error: "Forbidden" }, { status: 403 })');
  });

  it("has no circular route/helper import or outer transaction TDZ reference", () => {
    expect(helperSource).not.toContain("from \"@/app/api/admin/products");
    expect(helperSource).not.toMatch(/entityId:\s*product\.id/);
    expect(routeSource).not.toMatch(/entityId:\s*product\.id/);
    expect(clientSource).not.toMatch(/const\s+approve[^\n]*\n[\s\S]*const\s+submitModeration/);
  });
});
