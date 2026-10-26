import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliveryFindUnique: vi.fn(),
  deliveryFindMany: vi.fn(),
  orderUpdate: vi.fn(),
  transaction: vi.fn(),
  deliveryUpdate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationCreateMany: vi.fn(),
  notificationFindMany: vi.fn(),
  auditCreate: vi.fn(),
  publish: vi.fn(),
  sendEmail: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  notifyAdmins: vi.fn(),
  createEarnings: vi.fn(),
  makeEarningAvailable: vi.fn(),
  markEarningsEligible: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  digitalDelivery: { findUnique: mocks.deliveryFindUnique, findMany: mocks.deliveryFindMany },
  order: { update: mocks.orderUpdate },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/realtime/publish", () => ({ publishNotification: mocks.publish }));
vi.mock("@/lib/email/service", () => ({ sendDigitalDeliveryEmail: mocks.sendEmail }));
vi.mock("@/lib/security/secrets", () => ({
  decryptSecret: mocks.decrypt,
  encryptSecret: mocks.encrypt,
  hashDownloadToken: vi.fn(),
  newDownloadToken: vi.fn(),
}));
vi.mock("@/lib/admin-notifications", () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock("@/lib/seller-finance", () => ({
  createSellerEarningsForPaidOrder: mocks.createEarnings,
  makeManualEarningAvailable: mocks.makeEarningAvailable,
  markEarningsEligibleForOrder: mocks.markEarningsEligible,
}));
vi.mock("@/lib/delivery/claim-inventory", () => ({ claimDeliveryInventory: vi.fn() }));

import { manuallyDeliver, notifyManualDeliverySellers } from "@/lib/delivery/service";

const input = { message: "Produk Anda sudah siap." };
const ownerId = "seller-owner";

function waitingDelivery(sellerUserId = ownerId) {
  return {
    id: "delivery-1",
    orderId: "order-1",
    type: "TEXT",
    status: "WAITING_MANUAL_DELIVERY",
    order: {
      id: "order-1",
      userId: "buyer-1",
      orderNumber: "ORDER-1",
      customerName: "Buyer",
      customerEmail: "buyer@example.test",
      status: "PAID",
      payment: { status: "PAID" },
    },
    orderItem: { id: "item-1", product: { seller: { userId: sellerUserId } } },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.deliveryFindUnique.mockResolvedValue(waitingDelivery());
  mocks.deliveryFindMany.mockResolvedValue([]);
  mocks.orderUpdate.mockResolvedValue({});
  mocks.deliveryUpdate.mockResolvedValue({ id: "delivery-1", status: "AWAITING_CONFIRMATION" });
  mocks.notificationCreate.mockResolvedValue({ id: "notification-1", userId: "buyer-1", createdAt: new Date() });
  mocks.notificationCreateMany.mockResolvedValue({ count: 0 });
  mocks.notificationFindMany.mockImplementation(async (query: { where: { id: { in: string[] } } }) =>
    query.where.id.in.map((id) => ({ id, userId: id.endsWith("a") ? "seller-a" : "seller-b", title: "Tugas", message: "", type: "DELIVERY_TASK", link: "/seller/orders", createdAt: new Date() })),
  );
  mocks.auditCreate.mockResolvedValue({});
  mocks.publish.mockResolvedValue(null);
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.encrypt.mockImplementation((value: string) => `encrypted:${value}`);
  mocks.decrypt.mockImplementation((value: string) => value);
  mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation({
    digitalDelivery: { update: mocks.deliveryUpdate },
    notification: { create: mocks.notificationCreate, createMany: mocks.notificationCreateMany, findMany: mocks.notificationFindMany },
    auditLog: { create: mocks.auditCreate },
  }));
});

describe("manual delivery seller authorization", () => {
  it("allows only the owner seller to send that manual item", async () => {
    await expect(manuallyDeliver("order-1", "delivery-1", ownerId, "SELLER", input)).resolves.toMatchObject({ status: "AWAITING_CONFIRMATION" });
    expect(mocks.deliveryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "delivery-1", status: "WAITING_MANUAL_DELIVERY" },
      data: expect.objectContaining({ status: "AWAITING_CONFIRMATION" }),
    }));
  });

  it("rejects another seller before any delivery state is changed", async () => {
    await expect(manuallyDeliver("order-1", "delivery-1", "seller-other", "SELLER", input)).rejects.toThrow("Seller tidak memiliki produk ini.");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deliveryUpdate).not.toHaveBeenCalled();
  });

  it("keeps an admin path for explicit assistance", async () => {
    await expect(manuallyDeliver("order-1", "delivery-1", "admin-1", "ADMIN", input)).resolves.toMatchObject({ status: "AWAITING_CONFIRMATION" });
    expect(mocks.deliveryUpdate).toHaveBeenCalledOnce();
  });

  it("creates one seller task per owner for a multi-seller order", async () => {
    mocks.deliveryFindMany.mockResolvedValue([
      { order: { orderNumber: "ORDER-1" }, orderItem: { product: { seller: { userId: "seller-a" } } } },
      { order: { orderNumber: "ORDER-1" }, orderItem: { product: { seller: { userId: "seller-a" } } } },
      { order: { orderNumber: "ORDER-1" }, orderItem: { product: { seller: { userId: "seller-b" } } } },
    ]);

    await expect(notifyManualDeliverySellers("order-1")).resolves.toBe(2);

    const rows = mocks.notificationCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((row: { userId: string }) => row.userId).sort()).toEqual(["seller-a", "seller-b"]);
    expect(rows.find((row: { userId: string }) => row.userId === "seller-a").message).toContain("2 item");
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });
});
