import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const refunds = readFileSync(new URL("../src/lib/refunds.ts", import.meta.url), "utf8");
const finance = readFileSync(new URL("../src/lib/seller-finance.ts", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../src/app/dashboard/wallet/page.tsx", import.meta.url), "utf8");
const sellerWallet = readFileSync(new URL("../src/app/seller/wallet/page.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../scripts/report-refund-reconciliation.ts", import.meta.url), "utf8");

describe("refund wallet reversal safeguards", () => {
  it("credits buyer and reverses seller in the same refund transaction", () => {
    expect(refunds).toContain('type: "REFUND_CREDIT"');
    expect(refunds).toContain("reverseOrderEarnings(tx, refund.orderId");
    expect(refunds).toContain('isolationLevel: "Serializable"');
  });
  it("uses actual net earning and does not debit pending earning", () => {
    expect(finance).toContain("earning.netAmount");
    expect(finance).toContain("if (!wasAvailable) return;");
    expect(finance).toContain('type: "REFUND_REVERSAL"');
  });
  it("makes seller reversal idempotent and part of available balance", () => {
    expect(finance).toContain("sellerWalletTransaction.upsert");
    expect(finance).toContain('"REFUND_REVERSAL"');
  });
  it("keeps buyer wallet server-scoped and exposes ledger details", () => {
    expect(wallet).toContain("session.user.id");
    expect(wallet).toContain("balanceAfter");
    expect(wallet).toContain("transaction.amount >= 0");
  });
  it("shows seller ledger reversal and supports existing refund reconciliation", () => {
    expect(sellerWallet).toContain("sellerWalletTransaction.findMany");
    expect(report).toContain('status: "REFUNDED"');
    expect(report).toContain('type: "REFUND_REVERSAL"');
  });
  it("labels a reversed pending sale without creating a seller debit", () => {
    expect(sellerWallet).toContain("Dibatalkan karena refund");
    expect(finance).toContain('transaction.type !== "SALE_AVAILABLE"');
    expect(finance).toContain('status === SellerEarningStatus.AVAILABLE || status === SellerEarningStatus.PAID_OUT');
  });
});
