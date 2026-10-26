import { describe, expect, it } from "vitest";
import { listenerCount, publishToUser, subscribeUser } from "@/lib/realtime/event-bus";
import { publishMessage, publishReadReceipt } from "@/lib/realtime/publish";

describe("realtime event bus", () => {
  it("delivers only to the subscribed user and cleans up listeners", () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeUser("user-a", (event) => received.push(event));
    const otherReceived: unknown[] = [];
    const unsubscribeOther = subscribeUser("user-b", (event) => otherReceived.push(event));
    publishToUser("user-a", { type: "notification", title: "A", dedupeKey: "notification:a" });
    publishToUser("user-b", { type: "notification", title: "B", dedupeKey: "notification:b" });
    expect(received).toHaveLength(1);
    expect(otherReceived).toHaveLength(1);
    expect((received[0] as { title: string }).title).toBe("A");
    expect(listenerCount("user-a")).toBe(1);
    unsubscribe();
    unsubscribeOther();
    expect(listenerCount("user-a")).toBe(0);
  });

  it("uses a stable message dedupe key without exposing message content", () => {
    const received: { dedupeKey: string; body?: string }[] = [];
    const unsubscribe = subscribeUser("user-a", (event) => received.push(event));
    publishMessage({ recipientId: "user-a", messageId: "message-1", conversationId: "conversation-1", href: "/messages/conversation-1", createdAt: new Date("2026-01-01T00:00:00Z") });
    expect(received[0]).toMatchObject({ dedupeKey: "message:message-1" });
    expect(received[0].body).toBeUndefined();
    unsubscribe();
  });

  it("delivers read receipts only to the original sender without creating a notification", () => {
    const senderEvents: Array<{ type: string; messageIds?: string[] }> = [];
    const otherEvents: unknown[] = [];
    const stopSender = subscribeUser("sender-a", (event) => senderEvents.push(event));
    const stopOther = subscribeUser("sender-b", (event) => otherEvents.push(event));

    publishReadReceipt({ recipientId: "sender-a", conversationId: "conversation-1", messageIds: ["message-1", "message-1"], readAt: new Date("2026-10-07T00:00:00.000Z") });

    stopSender();
    stopOther();
    expect(senderEvents).toEqual([expect.objectContaining({ type: "read-receipt", messageIds: ["message-1"] })]);
    expect(otherEvents).toHaveLength(0);
  });
});
