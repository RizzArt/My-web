import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findConversation: vi.fn(),
  updateManyAndReturn: vi.fn(),
  markNotificationsRead: vi.fn(),
  publishReadReceipt: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findUnique: mocks.findConversation },
    message: { updateManyAndReturn: mocks.updateManyAndReturn },
    notification: { updateMany: mocks.markNotificationsRead },
  },
}));
vi.mock("@/lib/realtime/publish", () => ({ publishReadReceipt: mocks.publishReadReceipt }));

import { POST } from "../src/app/api/conversations/[conversationId]/read/route";

const params = { params: Promise.resolve({ conversationId: "conversation-test" }) };
const buyerSeller = {
  id: "conversation-test",
  customerId: "buyer-1",
  sellerId: "seller-profile-1",
  seller: { userId: "seller-1" },
  adminSupport: false,
  customerDeletedAt: null,
  sellerDeletedAt: null,
  adminDeletedAt: null,
};

function readRequest(messageIds: string[]) {
  return new Request("http://localhost/api/conversations/conversation-test/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageIds }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findConversation.mockResolvedValue(buyerSeller);
  mocks.updateManyAndReturn.mockResolvedValue([]);
  mocks.markNotificationsRead.mockResolvedValue({ count: 0 });
  mocks.publishReadReceipt.mockResolvedValue(null);
});

describe("chat read receipts", () => {
  it("rejects a nonparticipant before any message or notification update", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "buyer-other", role: "CUSTOMER" } });

    const response = await POST(readRequest(["message-visible"]), params);

    expect(response.status).toBe(403);
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled();
    expect(mocks.markNotificationsRead).not.toHaveBeenCalled();
  });

  it("records only visible counterpart messages in the authorized conversation and notifies their sender", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "buyer-1", role: "CUSTOMER" } });
    mocks.updateManyAndReturn.mockResolvedValue([{ id: "message-visible", senderId: "seller-1" }]);

    const response = await POST(readRequest(["message-visible", "message-visible", "message-own", "message-other-conversation"]), params);

    expect(response.status).toBe(200);
    expect(mocks.updateManyAndReturn).toHaveBeenCalledTimes(1);
    const update = mocks.updateManyAndReturn.mock.calls[0][0];
    expect(update.where).toMatchObject({
      conversationId: "conversation-test",
      id: { in: ["message-visible", "message-own", "message-other-conversation"] },
      senderId: { not: "buyer-1" },
      readAt: null,
    });
    expect(update.data).toMatchObject({ isRead: true, readAt: expect.any(Date) });
    expect(mocks.markNotificationsRead).toHaveBeenCalledWith({
      where: { userId: "buyer-1", conversationId: "conversation-test", type: "CHAT", isRead: false },
      data: { isRead: true },
    });
    expect(mocks.publishReadReceipt).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: "seller-1",
      conversationId: "conversation-test",
      messageIds: ["message-visible"],
      readAt: expect.any(Date),
    }));
    await expect(response.json()).resolves.toMatchObject({ readMessageIds: ["message-visible"], readAt: expect.any(String) });
  });

  it("respects the reader's deleted-history cutoff and returns no fabricated receipt", async () => {
    const cutoff = new Date("2026-10-01T00:00:00.000Z");
    mocks.auth.mockResolvedValue({ user: { id: "buyer-1", role: "CUSTOMER" } });
    mocks.findConversation.mockResolvedValue({ ...buyerSeller, customerDeletedAt: cutoff });

    const response = await POST(readRequest(["message-before-clear"]), params);

    expect(response.status).toBe(200);
    expect(mocks.updateManyAndReturn.mock.calls[0][0].where.createdAt).toEqual({ gt: cutoff });
    expect(mocks.markNotificationsRead).not.toHaveBeenCalled();
    expect(mocks.publishReadReceipt).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ readMessageIds: [], readAt: null });
  });

  it("rejects oversized or malformed visible-message lists", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "buyer-1", role: "CUSTOMER" } });
    const response = await POST(readRequest(Array.from({ length: 101 }, (_, index) => `message-${index}`)), params);

    expect(response.status).toBe(400);
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled();
  });
});
