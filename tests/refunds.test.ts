import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefundWindowOpen, normalizePayout, refundDeadline } from "@/lib/refunds";
import { parseAdminRefundStatus } from "@/lib/admin-refunds";

const refundSource = readFileSync(new URL("../src/lib/refunds.ts", import.meta.url), "utf8");
const buyerRoute = readFileSync(new URL("../src/app/api/orders/[orderId]/refund/route.ts", import.meta.url), "utf8");
const deliverySource = readFileSync(new URL("../src/lib/delivery/service.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const adminApi = readFileSync(new URL("../src/app/api/admin/refunds/route.ts", import.meta.url), "utf8");
const adminQuery = readFileSync(new URL("../src/lib/admin-refunds.ts", import.meta.url), "utf8");
const adminPage = readFileSync(new URL("../src/app/admin/refunds/page.tsx", import.meta.url), "utf8");
const adminHeader = readFileSync(new URL("../src/components/header.tsx", import.meta.url), "utf8");
const mobileMenu = readFileSync(new URL("../src/components/mobile-menu.tsx", import.meta.url), "utf8");
const buyerPage = readFileSync(new URL("../src/app/dashboard/orders/[orderId]/page.tsx", import.meta.url), "utf8");

describe("refund rules", () => {
  const completed = new Date("2026-09-28T00:00:00.000Z");
  it("allows a completed order inside 24 hours", () => expect(isRefundWindowOpen(completed, new Date("2026-09-28T23:59:59.999Z"))).toBe(true));
  it("allows the exact 24 hour boundary", () => expect(isRefundWindowOpen(completed, refundDeadline(completed))).toBe(true));
  it("rejects after 24 hours", () => expect(isRefundWindowOpen(completed, new Date("2026-09-29T00:00:00.001Z"))).toBe(false));
  it("rejects a missing completedAt", () => expect(isRefundWindowOpen(null)).toBe(false));
  it("uses completedAt rather than updatedAt", () => expect(refundSource).toContain("order.completedAt"));
  it("requires completed status", () => expect(refundSource).toContain('order.status !== "COMPLETED"'));
  it("scopes the order to the logged-in user", () => expect(refundSource).toContain("userId: input.userId"));
  it("uses the server order total", () => expect(refundSource).toContain("amount: order.total"));
  it("does not accept a client amount", () => expect(buyerRoute).not.toContain("amount:"));
  it("has a unique order refund", () => expect(schema).toMatch(/orderId\s+String\s+@unique/));
  it("supports both refund methods", () => expect(schema).toContain("ACCOUNT_BALANCE\n  MANUAL_TRANSFER"));
  it("supports all refund states", () => expect(schema).toContain("PENDING\n  APPROVED\n  REJECTED\n  REFUNDED"));
  it("requires manual payout fields in service", () => expect(refundSource).toContain("Data rekening atau e-wallet wajib diisi"));
  it("normalizes payout input", () => expect(normalizePayout("  Bank   Central ")).toBe("Bank Central"));
  it("encrypts payout account numbers", () => expect(refundSource).toContain("encryptSecret"));
  it("uses a customer balance", () => expect(schema).toMatch(/\bbalance\s+Int\s+@default\(0\)/));
  it("has a wallet ledger", () => expect(schema).toContain("model WalletTransaction"));
  it("has a unique refund ledger reference", () => expect(schema).toMatch(/refundRequestId\s+String\?\s+@unique/));
  it("credits inside a transaction", () => expect(refundSource).toContain('prisma.$transaction(async (tx)'));
  it("uses serializable isolation", () => expect(refundSource).toContain('isolationLevel: "Serializable"'));
  it("marks account refunds directly refunded", () => expect(refundSource).toContain('method === "ACCOUNT_BALANCE" ? "REFUNDED" : "APPROVED"'));
  it("does not credit manual transfer refunds", () => expect(refundSource).toContain('if (refund.method === "MANUAL_TRANSFER")'));
  it("rejects only pending refunds", () => expect(refundSource).toContain('status: "PENDING"'));
  it("marks manual refunds only from approved", () => expect(refundSource).toContain('status: "APPROVED"'));
  it("sets completedAt when delivery completion first occurs", () => expect(deliverySource).toContain('completedAt: new Date()'));

  it("lists pending refunds in the admin page and API", () => {
    expect(adminApi).toContain("findAdminRefunds(status)");
    expect(adminPage).toContain('"PENDING"');
    expect(adminPage).toContain("RefundActions");
    expect(adminPage).toContain("row.status");
  });

  it("returns all statuses without a filter and filters only valid Prisma statuses", () => {
    expect(parseAdminRefundStatus(undefined)).toBeUndefined();
    expect(parseAdminRefundStatus(null)).toBeUndefined();
    expect(parseAdminRefundStatus("PENDING")).toBe("PENDING");
    expect(parseAdminRefundStatus("APPROVED")).toBe("APPROVED");
    expect(parseAdminRefundStatus("REJECTED")).toBe("REJECTED");
    expect(parseAdminRefundStatus("REFUNDED")).toBe("REFUNDED");
    expect(parseAdminRefundStatus("CUSTOMER_ONLY")).toBeUndefined();
    expect(adminQuery).toContain("where: adminRefundWhere(status)");
    expect(adminQuery).toContain('orderBy: { createdAt: "desc" }');
    expect(adminApi).not.toContain("userId");
  });

  it("keeps admin refund authorization and makes the buyer menu available", () => {
    expect(adminApi).toContain('session.user.role !== "ADMIN"');
    expect(adminHeader).toContain('href="/admin/refunds"');
    expect(mobileMenu).toContain('["Pengajuan Refund", "/admin/refunds"]');
  });

  it("renders the buyer refund card once after all delivery items", () => {
    expect(buyerPage).toContain("{refundSection}{canReview");
    expect(buyerPage.indexOf("{refundSection}{canReview")).toBeGreaterThan(buyerPage.indexOf("order.deliveries.map"));
    expect(buyerPage.match(/\{refundSection\}/g)).toHaveLength(1);
  });
});
