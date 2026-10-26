import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  db: { payment: { findFirst: vi.fn() }, $transaction: vi.fn(), order: { findUnique: vi.fn() } },
  handleWebhook: vi.fn(),
  process: vi.fn(),
  notify: vi.fn(),
  fulfill: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/payments/midtrans", () => ({ paymentProvider: { handleWebhook: m.handleWebhook } }));
vi.mock("@/lib/payments/fulfillment", () => ({ processPaymentWebhook: m.process }));
vi.mock("@/lib/payments/paid-order-fulfillment", () => ({ fulfillPaidOrder: m.fulfill }));
vi.mock("@/lib/admin-notifications", () => ({ notifyAdmins: m.notify }));

import { POST } from "@/app/api/payments/webhook/route";

describe("top-up refund webhook notification retry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.handleWebhook.mockReturnValue({ provider: "midtrans", providerEventId: "same-refund", providerTransactionId: "provider-1", orderNumber: "KS-1", status: "REFUNDED", amount: 10_000, eventType: "refund", payload: {} });
    m.db.payment.findFirst.mockResolvedValue({ provider: "MIDTRANS" });
    m.db.$transaction.mockImplementation(async (operation: (tx: object) => unknown) => operation({}));
    m.process.mockResolvedValueOnce({ duplicate: false, status: "REFUNDED", reviewTopUpId: "topup-1" }).mockResolvedValueOnce({ duplicate: true, status: "REFUNDED", reviewTopUpId: "topup-1" });
    m.notify.mockRejectedValueOnce(new Error("transient notification failure")).mockResolvedValueOnce(undefined);
  });

  it("acknowledges after a committed notification failure and retries the same stable event key on duplicate callback", async () => {
    const request = () => new Request("https://example.test/api/payments/webhook", { method: "POST", body: "{}" });
    const first = await POST(request());
    const second = await POST(request());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true, status: "REFUNDED" });
    expect(m.notify).toHaveBeenCalledTimes(2);
    expect(m.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventKey: "studio-topup-refund-review:topup-1" }));
    expect(m.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventKey: "studio-topup-refund-review:topup-1" }));
    expect(m.fulfill).not.toHaveBeenCalled();
  });
});
