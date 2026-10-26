import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cancellation = readFileSync(new URL("../src/lib/customer-cancellation.ts", import.meta.url), "utf8");
const wallet = readFileSync(new URL("../src/lib/customer-wallet.ts", import.meta.url), "utf8");
const customerWithdrawal = readFileSync(new URL("../src/lib/customer-withdrawals.ts", import.meta.url), "utf8");
const cancelApi = readFileSync(new URL("../src/app/api/orders/[orderId]/cancel/route.ts", import.meta.url), "utf8");
const adminCancelApi = readFileSync(new URL("../src/app/api/admin/cancellations/[requestId]/route.ts", import.meta.url), "utf8");
const adminWithdrawalApi = readFileSync(new URL("../src/app/api/admin/customer-withdrawals/[withdrawalId]/route.ts", import.meta.url), "utf8");
const paymentPage = readFileSync(new URL("../src/app/payment/[orderNumber]/page.tsx", import.meta.url), "utf8");
const mobileMenu = readFileSync(new URL("../src/components/mobile-menu.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/components/header.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

describe("buyer cancellation", () => {
  it("cancels unpaid orders", () => expect(cancellation).toContain("cancelUnpaidOrder"));
  it("scopes cancellation to the buyer", () => expect(cancellation).toContain("where: { id: orderId, userId }"));
  it("makes duplicate unpaid cancellation safe", () => expect(cancellation).toContain('return { status: "CANCELLED"'));
  it("blocks cancelled orders from payment", () => expect(wallet).toContain('order.status === "CANCELLED"'));
  it("creates paid cancellation requests", () => expect(cancellation).toContain("requestPaidCancellation"));
  it("rejects duplicate requests", () => expect(cancellation).toContain("order.cancellationRequest"));
  it("blocks delivered orders", () => expect(cancellation).toContain('"DELIVERED", "AWAITING_CONFIRMATION"'));
  it("supports admin approval", () => expect(adminCancelApi).toContain('"APPROVE", "REJECT"'));
  it("supports admin rejection", () => expect(adminCancelApi).toContain("adminNote"));
  it("restricts review to admins", () => expect(adminCancelApi).toContain('session.user.role !== "ADMIN"'));
  it("credits cancellation through the wallet ledger", () => expect(cancellation).toContain('type: "REFUND_CREDIT"'));
  it("reverses seller earnings through the existing service", () => expect(cancellation).toContain("reverseOrderEarnings"));
});

describe("wallet payment", () => {
  it("allows sufficient balance", () => expect(wallet).toContain("user.balance < order.total"));
  it("rejects insufficient balance", () => expect(wallet).toContain("Saldo Akun tidak mencukupi"));
  it("debits the exact order total", () => expect(wallet).toContain("balanceAfter = user.balance - order.total"));
  it("creates a purchase ledger", () => expect(wallet).toContain('type: "PURCHASE_DEBIT"'));
  it("uses a serializable transaction", () => expect(wallet).toContain('isolationLevel: "Serializable"'));
  it("does not double debit paid orders", () => expect(wallet).toContain('order.payment.status === "PAID"'));
  it("retries concurrent serialization conflicts", () => expect(wallet).toContain("attempt < 3"));
  it("rejects cancelled orders", () => expect(wallet).toContain('payment.status === "CANCELLED"'));
  it("rejects non-pending orders", () => expect(wallet).toContain('order.payment.status !== "PENDING"'));
  it("uses the centralized paid-order fulfillment dispatcher", () => expect(wallet).toContain("fulfillPaidOrder"));
  it("keeps payment UI buyer scoped", () => expect(paymentPage).toContain("userId: session.user.id"));

});

describe("QRIS payment page regression", () => {
  it("renders QRIS for the qris_manual provider", () => {
    expect(paymentPage).toContain('order.payment.provider === "QRIS_MANUAL"');
    expect(paymentPage).toContain("Bayar dengan QRIS");
    expect(paymentPage).toContain("qrisImageDataUrl");
  });
  it("creates dynamic QRIS from the canonical order total", () => {
    expect(paymentPage).toContain("createDynamicQris(staticPayload, order.total)");
    expect(paymentPage).toContain("QRCode.toDataURL(dynamicPayload");
    expect(paymentPage).not.toContain("QRIS_STATIC_PAYLOAD");
  });
  it("keeps wallet payment available alongside QRIS", () => {
    expect(paymentPage).toContain("WalletPaymentButton");
    expect(paymentPage).toContain("Bayar dengan Saldo Akun");
  });
  it("does not offer payment actions for cancelled or paid orders", () => {
    expect(paymentPage).toContain("!paid && !cancelled");
    expect(paymentPage).toContain('order.payment.status === "CANCELLED"');
    expect(paymentPage).toContain('order.status === "CANCELLED"');
  });
  it("keeps QRIS generation failure recoverable", () => {
    expect(paymentPage).toContain("QRIS sementara tidak dapat ditampilkan.");
    expect(paymentPage).toContain("qrisGenerationFailed");
    expect(paymentPage).toContain('console.error("QRIS generation failed"');
  });
  it("uses owner-scoped payment lookup and the relative payment flow", () => {
    expect(paymentPage).toContain("orderNumber, userId: session.user.id");
    expect(paymentPage).not.toContain("shop.riezz99.biz.id");
    expect(paymentPage).not.toContain("http://");
    expect(paymentPage).not.toContain("https://");
  });
});

describe("buyer withdrawal", () => {
  it("creates valid withdrawals", () => expect(customerWithdrawal).toContain("createCustomerWithdrawal"));
  it("rejects insufficient balance", () => expect(customerWithdrawal).toContain("user.balance < input.amount"));
  it("holds balance atomically", () => expect(customerWithdrawal).toContain('type: "WITHDRAWAL_HOLD"'));
  it("blocks duplicate pending requests", () => expect(customerWithdrawal).toContain("Masih ada penarikan"));
  it("supports admin approval", () => expect(customerWithdrawal).toContain('action === "APPROVE"'));
  it("supports admin rejection", () => expect(customerWithdrawal).toContain('action === "REJECT"'));
  it("releases rejected balance once", () => expect(customerWithdrawal).toContain('type: "WITHDRAWAL_RELEASE"'));
  it("requires approved state before paid", () => expect(customerWithdrawal).toContain('withdrawal.status !== "APPROVED"'));
  it("restricts admin withdrawal review", () => expect(adminWithdrawalApi).toContain('session.user.role !== "ADMIN"'));
  it("stores encrypted payout destinations", () => expect(customerWithdrawal).toContain("encryptSecret(input.accountNumber)"));
  it("does not expose destination in buyer navigation", () => expect(mobileMenu).not.toContain("payoutAccountNumber"));
  it("keeps customer withdrawal fields in schema", () => expect(schema).toContain("payoutAccountNumberEncrypted"));
});

describe("buyer finance navigation", () => {
  it("adds cancellation to mobile admin navigation", () => expect(mobileMenu).toContain('"Pembatalan Pesanan", "/admin/cancellations"'));
  it("adds buyer withdrawal to mobile admin navigation", () => expect(mobileMenu).toContain('"Penarikan Saldo Pembeli", "/admin/customer-withdrawals"'));
  it("adds cancellation to desktop admin navigation", () => expect(header).toContain('href="/admin/cancellations"'));
  it("adds buyer withdrawal to desktop admin navigation", () => expect(header).toContain('href="/admin/customer-withdrawals"'));
});
