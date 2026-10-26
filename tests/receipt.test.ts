import { readFileSync } from "node:fs";
import type { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findFirst: mocks.findFirst },
    storeSetting: { findUnique: mocks.findUnique },
  },
}));

import {
  ReceiptAuthenticationError,
  buildPurchaseReceipt,
  canViewReceipt,
  formatReceiptCurrency,
  getPurchaseReceipt,
} from "@/lib/receipt";

const receiptPage = readFileSync(new URL("../src/app/orders/[orderNumber]/receipt/page.tsx", import.meta.url), "utf8");
const receiptSource = readFileSync(new URL("../src/lib/receipt.ts", import.meta.url), "utf8");
const buyerDetail = readFileSync(new URL("../src/app/dashboard/orders/[orderId]/page.tsx", import.meta.url), "utf8");
const adminDetail = readFileSync(new URL("../src/app/admin/orders/[orderId]/page.tsx", import.meta.url), "utf8");
const paymentPage = readFileSync(new URL("../src/app/payment/[orderNumber]/page.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: "KS-RECEIPT-1",
    userId: "buyer-1",
    customerName: "Pembeli Snapshot",
    customerEmail: "buyer@example.test",
    status: "PAID" as const,
    subtotal: 20000,
    total: 20000,
    createdAt: new Date("2026-10-11T02:00:00.000Z"),
    payment: {
      status: "PAID" as const,
      provider: "IPAYMU",
      externalId: "ipaymu:123456",
      amount: 20000,
      paidAt: new Date("2026-10-11T02:05:00.000Z"),
    },
    items: [{ productName: "Nama Produk Saat Checkout", unitPrice: 10000, quantity: 2 }],
    refundRequest: null,
    ...overrides,
  };
}

const store = {
  storeName: "Riezz99",
  supportEmail: "support@riezz99.example",
  storeEmail: "store@riezz99.example",
  whatsapp: "08123456789",
  timezone: "Asia/Jakarta",
};

const viewer = (id: string, role: Role) => ({ id, role });

describe("purchase receipt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findFirst.mockResolvedValue(order());
    mocks.findUnique.mockResolvedValue(store);
  });

  it("allows a buyer to read only their own paid receipt", async () => {
    const receipt = await getPurchaseReceipt("KS-RECEIPT-1", viewer("buyer-1", "CUSTOMER"));
    expect(receipt?.orderNumber).toBe("KS-RECEIPT-1");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderNumber: "KS-RECEIPT-1", userId: "buyer-1" } }));
  });

  it("does not disclose another buyer's receipt", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const receipt = await getPurchaseReceipt("KS-RECEIPT-1", viewer("buyer-2", "CUSTOMER"));
    expect(receipt).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderNumber: "KS-RECEIPT-1", userId: "buyer-2" } }));
  });

  it("requires authentication before querying a receipt", async () => {
    await expect(getPurchaseReceipt("KS-RECEIPT-1", null)).rejects.toBeInstanceOf(ReceiptAuthenticationError);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("allows an admin to read a receipt without weakening buyer ownership", async () => {
    const receipt = await getPurchaseReceipt("KS-RECEIPT-1", viewer("admin-1", "ADMIN"));
    expect(receipt?.buyer.email).toBe("buyer@example.test");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderNumber: "KS-RECEIPT-1" } }));
  });

  it("keeps a seller scoped as a buyer unless the seller owns the order", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(getPurchaseReceipt("KS-RECEIPT-1", viewer("seller-1", "SELLER"))).resolves.toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orderNumber: "KS-RECEIPT-1", userId: "seller-1" } }));
  });

  it("does not issue a paid receipt for pending, failed, expired, or cancelled transactions", () => {
    expect(canViewReceipt("PENDING", "PENDING", null)).toBe(false);
    expect(canViewReceipt("FAILED", "PENDING", null)).toBe(false);
    expect(canViewReceipt("EXPIRED", "EXPIRED", null)).toBe(false);
    expect(canViewReceipt("PAID", "CANCELLED", null)).toBe(false);
  });

  it("builds a receipt only from a verified paid transaction", () => {
    expect(buildPurchaseReceipt(order(), store)?.totalPaid).toBe(20000);
    expect(buildPurchaseReceipt(order({ payment: { ...order().payment, status: "PENDING" } }), store)).toBeNull();
  });

  it("marks refunded and partially refunded receipts without hiding the original payment", () => {
    const receipt = buildPurchaseReceipt(order({ refundRequest: { status: "REFUNDED", amount: 5000, refundedAt: new Date("2026-10-12T02:00:00.000Z") } }), store);
    expect(receipt?.refund).toMatchObject({ status: "REFUNDED", amount: 5000, netPaid: 15000 });
  });

  it("uses OrderItem snapshots rather than current Product data", () => {
    const receipt = buildPurchaseReceipt(order(), store);
    expect(receipt?.items).toEqual([{ name: "Nama Produk Saat Checkout", unitPrice: 10000, quantity: 2, subtotal: 20000 }]);
    expect(receiptSource).toContain("productName: true");
    expect(receiptSource).not.toContain("product: {");
  });

  it("calculates discount or fee from the verified amount and preserves the equation", () => {
    const discounted = buildPurchaseReceipt(order({ total: 18000, payment: { ...order().payment, amount: 18000 } }), store);
    expect(discounted).toMatchObject({ subtotal: 20000, discount: 2000, serviceFee: 0, tax: 0, totalPaid: 18000 });
    expect(discounted?.subtotal - discounted!.discount + discounted!.serviceFee + discounted!.tax).toBe(discounted?.totalPaid);

    const withFee = buildPurchaseReceipt(order({ total: 22000, payment: { ...order().payment, amount: 22000 } }), store);
    expect(withFee).toMatchObject({ subtotal: 20000, discount: 0, serviceFee: 2000, tax: 0, totalPaid: 22000 });
  });

  it("uses the verified payment amount and flags an inconsistent order ledger", () => {
    const receipt = buildPurchaseReceipt(order({ total: 19000, payment: { ...order().payment, amount: 20000 } }), store);
    expect(receipt).toMatchObject({ totalPaid: 20000, orderTotal: 19000, hasLedgerMismatch: true });
  });

  it("excludes raw payment payloads and unsafe references", () => {
    const receipt = buildPurchaseReceipt(order({ payment: { ...order().payment, externalId: "token=secret-webhook-payload" } }), store);
    expect(receipt?.paymentReference).toBeNull();
    expect(JSON.stringify(receipt)).not.toContain("secret-webhook-payload");
    expect(receiptSource).not.toContain("paymentEvent");
    expect(receiptSource).not.toContain("payoutAccountNumberEncrypted");
  });

  it("formats receipt money as Indonesian rupiah", () => {
    expect(formatReceiptCurrency(20000)).toContain("20.000");
  });

  it("keeps server authorization, no-store/noindex, and print controls in the receipt route", () => {
    expect(receiptPage).toContain('if (!session?.user?.id) redirect("/login")');
    expect(receiptPage).toContain("if (!receipt) notFound()");
    expect(receiptPage).toContain("noStore()");
    expect(receiptPage).toContain("index: false, follow: false");
    expect(globalStyles).toContain("@media print");
    expect(globalStyles).toContain(".receipt-actions");
    expect(globalStyles).toContain("break-inside: avoid");
  });

  it("shows receipt and print links only from paid-aware buyer, payment, and admin pages", () => {
    for (const source of [buyerDetail, paymentPage, adminDetail]) {
      expect(source).toContain("ReceiptLinks");
      expect(source).toContain("receiptAvailable");
    }
  });
});
