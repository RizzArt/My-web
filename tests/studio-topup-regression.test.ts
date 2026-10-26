import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Studio Credit top-up regression contract", () => {
  it("keeps the package catalog and purchase values server-side", () => {
    const catalog = read("src/lib/studio/topup-packages.ts");
    expect(catalog).toContain('STUDIO_100');
    expect(catalog).toContain('price: 10_000');
    expect(catalog).toContain('credits: 100');
  });

  it("creates a dedicated top-up record, without marketplace order items", () => {
    const source = read("src/lib/studio/topups.ts");
    expect(source).toContain("studioCreditTopUp: { create:");
    expect(source).toContain('subtotal: studioPackage.price');
    expect(source).toContain('total: studioPackage.price');
    expect(source).not.toContain("items: { create:");
  });

  it("uses a serializable, idempotent fulfillment ledger", () => {
    const source = read("src/lib/studio/topups.ts");
    expect(source).toContain('isolationLevel: "Serializable"');
    expect(source).toContain('topUpId');
    expect(source).toContain('type: "TOPUP_PURCHASE"');
    expect(source).toContain("P2002");
    expect(source).toContain("P2034");
  });

  it("routes paid top-ups away from delivery and seller earnings", () => {
    const dispatcher = read("src/lib/payments/paid-order-fulfillment.ts");
    expect(dispatcher).toContain("fulfillStudioCreditTopUp");
    expect(dispatcher).toContain("deliverOrder(orderId)");
    const earnings = read("src/lib/seller-finance.ts");
    expect(earnings).toContain("studioCreditTopUp");
  });

  it("accepts only packageCode at the authenticated top-up endpoint", () => {
    const route = read("src/app/api/studio/top-ups/route.ts");
    expect(route).toContain("packageCode");
    expect(route).toContain("session.user.id");
    expect(route).toContain("isActive");
    expect(route).not.toContain("parsed.data.price");
    expect(route).not.toContain("parsed.data.credits");
  });
});
