import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  markMessagesRead: vi.fn(),
  markNotificationsRead: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findUnique: mocks.findUnique },
    message: { findMany: mocks.findMany, updateMany: mocks.markMessagesRead },
    notification: { updateMany: mocks.markNotificationsRead },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/realtime/publish", () => ({ publishMessage: vi.fn(), publishReadReceipt: vi.fn() }));

import { GET, POST } from "../src/app/api/conversations/[conversationId]/messages/route";

const cutoff = new Date("2026-09-30T04:00:00.000Z");
const params = { params: Promise.resolve({ conversationId: "conversation-test" }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.markMessagesRead.mockResolvedValue({ count: 0 });
  mocks.markNotificationsRead.mockResolvedValue({ count: 0 });
});

describe("deleted chat history", () => {
  it.each([
    ["CUSTOMER", "buyer", "customerDeletedAt", false],
    ["SELLER", "seller-user", "sellerDeletedAt", false],
    ["ADMIN", "admin-user", "adminDeletedAt", true],
  ])("keeps old messages hidden for %s after reopening", async (role, id, field, adminSupport) => {
    mocks.auth.mockResolvedValue({ user: { role, id } });
    mocks.findUnique.mockResolvedValue({
      id: "conversation-test", customerId: "buyer", sellerId: "seller",
      seller: { userId: "seller-user", storeName: "Store" }, adminSupport,
      customerDeletedAt: null, sellerDeletedAt: null, adminDeletedAt: null,
      [field]: cutoff,
    });
    const response = await GET(new Request("http://localhost/api/messages"), params);
    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.createdAt).toEqual({ gt: cutoff });
    expect(mocks.markMessagesRead).not.toHaveBeenCalled();
    expect(mocks.markNotificationsRead).not.toHaveBeenCalled();
    expect(mocks.findMany.mock.calls[0][0].select.readAt).toBe(true);
    expect((await response.json()).historyClearedAt).toBe(cutoff.toISOString());
  });

  it("does not hide the other participant's history", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "SELLER", id: "seller-user" } });
    mocks.findUnique.mockResolvedValue({
      customerId: "buyer", sellerId: "seller",
      seller: { userId: "seller-user", storeName: "Store" }, adminSupport: false,
      customerDeletedAt: cutoff, sellerDeletedAt: null, adminDeletedAt: null,
    });
    await GET(new Request("http://localhost/api/messages"), params);
    expect(mocks.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });

  it("combines the deletion cutoff with incremental pagination", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "CUSTOMER", id: "buyer" } });
    mocks.findUnique.mockResolvedValue({
      customerId: "buyer", sellerId: "seller",
      seller: { userId: "seller-user" }, adminSupport: false,
      customerDeletedAt: cutoff,
    });
    await GET(new Request("http://localhost/api/messages?afterCreatedAt=2026-09-29T00:00:00Z&afterId=old"), params);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gt: cutoff });
    expect(where.OR).toHaveLength(2);
  });

  it("allows new messages without resetting either participant's cutoff", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "CUSTOMER", id: "buyer", name: "Buyer" } });
    mocks.findUnique.mockResolvedValue({
      customerId: "buyer", sellerId: "seller",
      seller: { userId: "seller-user", storeName: "Store" }, adminSupport: false,
      customerDeletedAt: cutoff, sellerDeletedAt: cutoff,
    });
    const update = vi.fn().mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operation) => operation({
      message: { create: vi.fn().mockResolvedValue({ id: "new-message", createdAt: new Date() }) },
      conversation: { update },
      notification: { create: vi.fn().mockResolvedValue({ userId: "seller-user", link: "/seller/messages/conversation-test" }) },
    }));
    const response = await POST(new Request("http://localhost/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Pesan baru" }),
    }), params);
    expect(response.status).toBe(201);
    const data = update.mock.calls[0][0].data;
    expect(data.customerDeletedAt).toBeUndefined();
    expect(data.sellerDeletedAt).toBeUndefined();
    expect(data.adminDeletedAt).toBeUndefined();
  });
});
