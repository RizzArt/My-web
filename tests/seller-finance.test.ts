import { describe, expect, it } from "vitest";
import { SellerEarningStatus } from "@prisma/client";
import { calculatePlatformFee, financeDateRange, sumFinanceEarnings, sumSellerAvailableBalance, sumSellerLifetimeEarnings, sumSellerPendingBalance, sumWithdrawals } from "@/lib/seller-finance";
import { maskPayoutDestination } from "@/lib/security/secrets";

describe("seller finance primitives", () => {
  it("calculates deterministic integer commission with half-up rounding", () => {
    expect(calculatePlatformFee(100000, 10)).toBe(10000);
    expect(calculatePlatformFee(105, 10)).toBe(11);
  });
  it("masks payout destinations", () => {
    expect(maskPayoutDestination("1234567890")).toBe("****7890");
  });
  it("sums admin GMV from paid seller earnings", () => {
    expect(sumFinanceEarnings([{ sellerId: "seller", paid: true, grossAmount: 1000, platformFee: 100, netAmount: 900 }]).grossAmount).toBe(1000);
  });
  it("sums platform fee from earning snapshots", () => {
    expect(sumFinanceEarnings([{ sellerId: "seller", paid: true, grossAmount: 1000, platformFee: 100, netAmount: 900 }]).platformFee).toBe(100);
  });
  it("sums seller net earnings from earning snapshots", () => {
    expect(sumFinanceEarnings([{ sellerId: "seller", paid: true, grossAmount: 1000, platformFee: 100, netAmount: 900 }]).netAmount).toBe(900);
  });
  it("excludes admin/platform products without a seller", () => {
    expect(sumFinanceEarnings([{ sellerId: null, paid: true, grossAmount: 5000, platformFee: 0, netAmount: 5000 }])).toEqual({ grossAmount: 0, platformFee: 0, netAmount: 0 });
  });
  it("excludes rejected withdrawals from outstanding", () => {
    expect(sumWithdrawals([{ status: "REJECTED", amount: 1000 }]).pending).toBe(0);
  });
  it("counts pending withdrawals as outstanding", () => {
    expect(sumWithdrawals([{ status: "PENDING", amount: 1000 }]).pending).toBe(1000);
  });
  it("counts approved unpaid withdrawals as outstanding", () => {
    expect(sumWithdrawals([{ status: "APPROVED", amount: 1000 }]).pending).toBe(1000);
  });
  it("counts paid withdrawals separately", () => {
    expect(sumWithdrawals([{ status: "PAID", amount: 1000 }]).paid).toBe(1000);
  });
  it("keeps seller finance scoped to the supplied seller rows", () => {
    expect(sumFinanceEarnings([{ sellerId: "seller-a", paid: true, grossAmount: 1000, platformFee: 100, netAmount: 900 }])).toEqual({ grossAmount: 1000, platformFee: 100, netAmount: 900 });
  });
  it("uses a 30 day period by default", () => {
    expect(financeDateRange(undefined).selected).toBe("30d");
  });
  it("returns zero for an empty finance period", () => {
    expect(sumFinanceEarnings([])).toEqual({ grossAmount: 0, platformFee: 0, netAmount: 0 });
    expect(sumWithdrawals([])).toEqual({ pending: 0, paid: 0 });
  });
  it("does not let a changed commission setting alter snapshots", () => {
    const historical = { sellerId: "seller", paid: true, grossAmount: 105, platformFee: 11, netAmount: 94 };
    expect(sumFinanceEarnings([historical])).toEqual({ grossAmount: 105, platformFee: 11, netAmount: 94 });
  });
  it("puts pending earnings in pending balance, not available", () => {
    const earning = { id: "pending", status: SellerEarningStatus.PENDING, netAmount: 14250 };
    expect(sumSellerPendingBalance([earning])).toBe(14250);
    expect(sumSellerAvailableBalance([{ type: "SALE_PENDING", amount: 14250, referenceType: "SellerEarning", referenceId: earning.id }], [earning])).toBe(0);
  });
  it("excludes reversed earnings from pending, available, and lifetime totals", () => {
    const earning = { id: "reversed", status: SellerEarningStatus.REVERSED, netAmount: 14250 };
    expect(sumSellerPendingBalance([earning])).toBe(0);
    expect(sumSellerAvailableBalance([{ type: "SALE_PENDING", amount: 14250, referenceType: "SellerEarning", referenceId: earning.id }, { type: "SALE_AVAILABLE", amount: 14250, referenceType: "SellerEarning", referenceId: earning.id }], [earning])).toBe(0);
    expect(sumSellerLifetimeEarnings([earning])).toBe(0);
  });
  it("allows available earnings to follow the existing ledger balance", () => {
    const earning = { id: "available", status: SellerEarningStatus.AVAILABLE, netAmount: 14250 };
    expect(sumSellerAvailableBalance([{ type: "SALE_AVAILABLE", amount: 14250, referenceType: "SellerEarning", referenceId: earning.id }, { type: "WITHDRAW_RESERVED", amount: -5000, referenceType: "Withdrawal", referenceId: "withdrawal" }], [earning])).toBe(9250);
  });
});
