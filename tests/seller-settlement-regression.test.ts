import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculatePlatformFee } from "@/lib/seller-finance";

const finance = readFileSync(new URL("../src/lib/seller-finance.ts", import.meta.url), "utf8");
const fulfillment = readFileSync(new URL("../src/lib/payments/fulfillment.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../src/lib/delivery/service.ts", import.meta.url), "utf8");
const markPaid = readFileSync(new URL("../src/app/api/admin/orders/[orderId]/mark-paid/route.ts", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../src/app/seller/wallet/page.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/app/seller/page.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

describe("seller settlement regression guards", () => {
  it("uses quantity and the configured commission snapshot", () => {
    expect(calculatePlatformFee(20000 * 3, 5)).toBe(3000);
    expect(finance).toContain("item.unitPrice * item.quantity");
    expect(finance).toContain("commissionPercent: settings.platformCommissionPercent");
  });

  it("creates earning from every paid production entry point", () => {
    expect(fulfillment).toContain("createSellerEarningsForPaidOrder(tx, payment.orderId)");
    expect(markPaid).toContain("createSellerEarningsForPaidOrder(tx, order.id)");
    expect(delivery).toContain("createSellerEarningsForPaidOrder(tx, orderId)");
  });

  it("keeps settlement idempotent and separates pending from available", () => {
    expect(schema).toContain("orderItemId       String              @unique");
    expect(schema).toContain("SALE_PENDING");
    expect(schema).toContain("SALE_AVAILABLE");
    expect(finance).toContain("upsert({");
    expect(finance).toContain("status: \"AVAILABLE\"");
  });

  it("does not credit platform products and handles each order item", () => {
    expect(finance).toContain("if (!item.product.sellerId) continue");
    expect(finance).toContain("for (const item of order.items)");
  });

  it("uses the same SellerProfile-scoped balance helper in wallet and dashboard", () => {
    expect(wallet).toContain("balanceSummary(seller.id)");
    expect(dashboard).toContain("balanceSummary(seller.id)");
    expect(wallet).toContain("where: { userId: session.user.id }");
    expect(dashboard).toContain("where: { userId: session.user.id }");
  });

  it("exposes identical available, pending, and total earning summaries", () => {
    expect(finance).toContain("totalEarnings");
    expect(wallet).toContain("summary.totalEarnings");
    expect(dashboard).toContain("balance.totalEarnings");
    expect(wallet).toContain("summary.pending");
    expect(dashboard).toContain("balance.pending");
  });

  it("keeps withdrawal decisions scoped to available balance", () => {
    const withdrawals = readFileSync(new URL("../src/app/api/seller/withdrawals/route.ts", import.meta.url), "utf8");
    expect(withdrawals).toContain("availableBalance(tx, seller.id)");
    expect(withdrawals).toContain("parsed.data.amount > available");
  });

  it("keeps withdrawal reservation in the ledger balance calculation", () => {
    expect(finance).toContain('"WITHDRAW_RESERVED"');
    expect(finance).toContain('"WITHDRAW_RELEASED"');
    expect(finance).toContain('"WITHDRAW_PAID"');
  });
});
