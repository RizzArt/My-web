import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publish: vi.fn(), enqueue: vi.fn(), drain: vi.fn(),
}));
vi.mock("@/lib/realtime/event-bus", () => ({
  publishToUser: mocks.publish,
}));
vi.mock("@/lib/push/server", () => ({
  enqueuePush: mocks.enqueue, drainPushQueue: mocks.drain,
}));

import {
  publishNotification, publishMessage,
} from "../src/lib/realtime/publish";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.publish.mockReturnValue({ type: "notification" });
  mocks.enqueue.mockResolvedValue({});
  mocks.drain.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

const notification = {
  id: "notification-1", userId: "buyer-1",
  title: "Pembayaran", message: "Pembayaran diterima",
  link: "/dashboard", createdAt: new Date(), type: "PAYMENT",
};

describe("worker push dispatch", () => {
  it("persists notification push without starting background dispatch", async () => {
    vi.stubEnv("PUSH_DEFER_DISPATCH", "true");
    await publishNotification(notification);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("also defers message dispatch in a worker", async () => {
    vi.stubEnv("PUSH_DEFER_DISPATCH", "true");
    await publishMessage({
      recipientId: "buyer-1", messageId: "message-1",
      conversationId: "conversation-1",
      href: "/messages/conversation-1", createdAt: new Date(),
    });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("keeps immediate dispatch for the website", async () => {
    vi.stubEnv("PUSH_DEFER_DISPATCH", "false");
    await publishNotification(notification);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.drain).toHaveBeenCalledWith(5);
  });
});
