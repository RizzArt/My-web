import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { productVisibilityWhere } from "@/lib/seller";

const adminPage = readFileSync(new URL("../src/app/admin/products/page.tsx", import.meta.url), "utf8");
const archiveRoute = readFileSync(new URL("../src/app/api/admin/products/[productId]/archive/route.ts", import.meta.url), "utf8");
const deleteRoute = readFileSync(new URL("../src/app/api/admin/products/[productId]/route.ts", import.meta.url), "utf8");
const sellerPage = readFileSync(new URL("../src/app/seller/products/page.tsx", import.meta.url), "utf8");

describe("admin product lifecycle", () => {
  it("lists all sellers and exposes product search/status filters", () => {
    expect(adminPage).toContain("produk dari semua seller/store");
    expect(adminPage).toContain("contains: query");
    expect(adminPage).toContain("ARCHIVED");
    expect(adminPage).toContain("moderation");
  });

  it("archives through a server-side admin-only endpoint and restores only approved products", () => {
    expect(archiveRoute).toContain('session?.user.role !== "ADMIN"');
    expect(archiveRoute).toContain('parsed.data.action === "ARCHIVE"');
    expect(archiveRoute).toContain('current.moderationStatus === "APPROVED"');
    expect(productVisibilityWhere()).toEqual({ isPublished: true, moderationStatus: "APPROVED" ,
      AND: [{
        OR: [
          { sellerId: null },
          { seller: { is: {
            isActive: true,
            user: { is: { isActive: true, role: "SELLER" } },
          } } },
        ],
      }],
    });
  });

  it("blocks permanent deletion when transactional history exists and isolates cleanup", () => {
    expect(deleteRoute).toContain("orderItems");
    expect(deleteRoute).toContain("promotions");
    expect(deleteRoute).toContain("riwayat transaksi");
    expect(deleteRoute).toContain("conversation.updateMany");
    expect(deleteRoute).toContain('session?.user.role !== "ADMIN"');
  });

  it("shows admin archives to the owning seller without changing seller ownership", () => {
    expect(sellerPage).toContain("Diarsipkan oleh Admin");
    expect(sellerPage).toContain("where: { sellerId: seller.id }");
  });
});
