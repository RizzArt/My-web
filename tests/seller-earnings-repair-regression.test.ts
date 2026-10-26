import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../scripts/repair-seller-earnings.ts", import.meta.url), "utf8");
const finance = readFileSync(new URL("../src/lib/seller-finance.ts", import.meta.url), "utf8");

describe("seller earnings repair regression guards", () => {
  it("applies only eligible RELEASE branches through the canonical release helper", () => {
    expect(script).toContain('const apply = process.argv.includes("--apply")');
    expect(script).toContain('candidate.action === "RELEASE"');
    expect(script).toContain("await releaseEarning(tx, earning.id)");
    expect(script).toContain("candidate.action === \"WAIT\"");
    expect(script).toContain("markEarningsEligibleForOrder(tx, candidate.orderId)");
  });

  it("moves the earning to AVAILABLE and creates one SALE_AVAILABLE ledger row", () => {
    expect(finance).toContain('status: "AVAILABLE"');
    expect(finance).toContain('type: "SALE_AVAILABLE", referenceType: "SellerEarning", referenceId: earning.id');
    expect(finance).toContain("upsert({");
  });

  it("requires completed delivery before the repair classifier considers an earning", () => {
    expect(script).toContain('item.deliveries.some((delivery) => delivery.status !== "DELIVERED")');
    expect(script).toContain('item.earning.status === "PENDING" && ledgerStatus !== "AVAILABLE" ? (item.earning.availableAt && item.earning.availableAt > now ? "WAIT" : "RELEASE")');
  });

  it("uses the earning reference as the idempotency key", () => {
    expect(finance).toContain("type_referenceType_referenceId");
    expect(finance).toContain('referenceType: "SellerEarning", referenceId: earning.id');
    expect(finance).toContain('availableAt: { lte: new Date() }');
  });

  it("does not notify or credit twice when release is repeated", () => {
    expect(finance).toContain("const existingLedger = await tx.sellerWalletTransaction.findUnique");
    expect(finance).toContain("if (!existingLedger)");
  });

  it("keeps the balance source of truth shared by wallet and dashboard", () => {
    expect(finance).toContain("availableBalance(tx, sellerId)");
    expect(finance).toContain('type: { in: ["SALE_AVAILABLE"');
    expect(finance).toContain("totalEarnings: lifetime._sum.netAmount ?? 0");
    expect(finance).toContain("nextPendingAvailableAt");
  });

  it("does not claim success after a failed transaction", () => {
    expect(script).toContain("main().catch");
    expect(script).toContain("process.exitCode = 1");
  });

  it("returns an explicit waiting state instead of bypassing the hold", () => {
    expect(finance).toContain('return "WAITING_HOLD"');
    expect(finance).toContain("export async function releaseDueSellerEarnings");
  });
});
