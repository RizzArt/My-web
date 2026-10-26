import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAccessConversation } from "@/lib/chat";
import { listenerCount, subscribeUser } from "@/lib/realtime/event-bus";
import { publishMessage } from "@/lib/realtime/publish";
import { acceptRealtimeEvent, applyReadReceipt, canRecordVisibleChatRead, getRealtimeDedupeKey, getVisibleUnreadMessageIds, isActiveConversation, mergeMessages, parseRealtimeEvent, reconcileOptimisticMessage, shouldShowIncomingToast } from "@/lib/realtime/client-state";

const streamRoute = readFileSync(new URL("../src/app/api/realtime/stream/route.ts", import.meta.url), "utf8");
const messageRoute = readFileSync(new URL("../src/app/api/conversations/[conversationId]/messages/route.ts", import.meta.url), "utf8");
const conversationSource = readFileSync(new URL("../src/components/conversation-page.tsx", import.meta.url), "utf8");
const notificationSource = () => readFileSync(new URL("../src/components/notification-center.tsx", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../src/components/realtime/realtime-provider.tsx", import.meta.url), "utf8");
const eventBusSource = readFileSync(new URL("../src/lib/realtime/event-bus.ts", import.meta.url), "utf8");

describe("realtime chat regression coverage", () => {
  const buyerSeller = { customerId: "buyer-a", sellerId: "seller-1", seller: { userId: "seller-a" }, adminSupport: false };
  const sellerAdmin = { customerId: "seller-a", sellerId: "seller-1", seller: { userId: "seller-a" }, adminSupport: true };

  it("authorizes buyer, seller, and admin conversation participants only", () => {
    expect(canAccessConversation(buyerSeller, { id: "buyer-a", role: "CUSTOMER" })).toBe(true);
    expect(canAccessConversation(buyerSeller, { id: "buyer-b", role: "CUSTOMER" })).toBe(false);
    expect(canAccessConversation(buyerSeller, { id: "seller-a", role: "SELLER" })).toBe(true);
    expect(canAccessConversation(buyerSeller, { id: "seller-b", role: "SELLER" })).toBe(false);
    expect(canAccessConversation(sellerAdmin, { id: "admin-a", role: "ADMIN" })).toBe(true);
    expect(canAccessConversation(sellerAdmin, { id: "seller-b", role: "SELLER" })).toBe(false);
  });

  it("keeps SSE authenticated and server-authorized", () => {
    expect(streamRoute).toContain("const session = await auth()");
    expect(streamRoute).toContain("if (!session?.user?.id)");
    expect(streamRoute).toContain("subscribeUser(userId");
    expect(messageRoute).toContain("canAccessConversation(conversation, session.user)");
    expect(messageRoute).toContain("senderId: session.user.id");
    expect(messageRoute).not.toContain("senderId: (await request.json())");
  });

  it("uses one same-origin SSE endpoint and a process-global event bus", () => {
    expect(providerSource).toContain('new EventSource("/api/realtime/stream")');
    expect(providerSource).toContain('source.addEventListener("message", onEvent)');
    expect(providerSource).toContain('source.addEventListener("notification", onEvent)');
    expect(providerSource).not.toMatch(/shop\.riezz99\.biz\.id|riezz99\.biz\.id/);
    expect(eventBusSource).toContain("globalThis");
    expect(eventBusSource).toContain("__riezz99RealtimeBus");
  });

  it("delivers a message only to the intended participant", () => {
    const buyerEvents: unknown[] = [];
    const otherEvents: unknown[] = [];
    const stopBuyer = subscribeUser("buyer-a", (event) => buyerEvents.push(event));
    const stopOther = subscribeUser("buyer-b", (event) => otherEvents.push(event));
    publishMessage({ recipientId: "buyer-a", messageId: "m-1", conversationId: "c-1", href: "/messages/c-1", createdAt: new Date("2026-01-01") });
    stopBuyer(); stopOther();
    expect(buyerEvents).toHaveLength(1);
    expect(otherEvents).toHaveLength(0);
  });

  it("merges duplicate server responses and reconciles optimistic IDs", () => {
    const server = { id: "m-2", createdAt: "2026-01-01T00:00:01.000Z", content: "halo" };
    const merged = mergeMessages([server], [server, server]);
    expect(merged).toHaveLength(1);
    const reconciled = reconcileOptimisticMessage([{ id: "optimistic-1", createdAt: "2026-01-01T00:00:00.000Z", content: "halo" }], "optimistic-1", server);
    expect(reconciled).toEqual([server]);
  });

  it("ignores duplicate SSE message IDs and keeps one listener per subscription", () => {
    const seen = new Set<string>();
    const event = { type: "message", dedupeKey: "message:m-3", conversationId: "c-1" };
    expect(acceptRealtimeEvent(event, seen)).toBe(true);
    expect(acceptRealtimeEvent(event, seen)).toBe(false);
    const stop = subscribeUser("seller-a", () => {});
    expect(listenerCount("seller-a")).toBe(1);
    stop();
    expect(listenerCount("seller-a")).toBe(0);
  });

  it("parses named message and notification event payloads", () => {
    expect(parseRealtimeEvent(JSON.stringify({ type: "message", id: "m-5", dedupeKey: "message:m-5" }))).toMatchObject({ type: "message", id: "m-5" });
    expect(parseRealtimeEvent(JSON.stringify({ type: "notification", id: "n-5", dedupeKey: "notification:n-5" }))).toMatchObject({ type: "notification", id: "n-5" });
    expect(parseRealtimeEvent("not-json")).toBeNull();
  });

  it("applies one read receipt to sender state without treating SSE or a hidden tab as read evidence", () => {
    const original = [{ id: "m-1", createdAt: "2026-10-07T00:00:00.000Z", senderId: "seller-a", readAt: null }, { id: "m-2", createdAt: "2026-10-07T00:01:00.000Z", senderId: "seller-a", readAt: null }];
    const updated = applyReadReceipt(original, { messageIds: ["m-1"], readAt: "2026-10-07T00:02:00.000Z" });
    expect(updated).toEqual([{ ...original[0], readAt: "2026-10-07T00:02:00.000Z" }, original[1]]);
    expect(applyReadReceipt(updated, { messageIds: ["m-1"], readAt: "2026-10-07T00:03:00.000Z" })).toBe(updated);
    expect(canRecordVisibleChatRead(false, true)).toBe(false);
    expect(canRecordVisibleChatRead(true, false)).toBe(false);
    expect(canRecordVisibleChatRead(true, true)).toBe(true);
    expect(getVisibleUnreadMessageIds([...original, original[0]], new Set(["m-1", "m-2"]), "buyer-a")).toEqual(["m-1", "m-2"]);
    expect(getVisibleUnreadMessageIds(original, new Set(["m-1"]), "seller-a")).toEqual([]);
  });

  it("does not discard new events when an explicit dedupe key is absent", () => {
    const seen = new Set<string>();
    const first = { type: "message" as const, id: "m-6" };
    const second = { type: "message" as const, id: "m-7" };
    expect(getRealtimeDedupeKey(first)).toBe("message:m-6");
    expect(acceptRealtimeEvent(first, seen)).toBe(true);
    expect(acceptRealtimeEvent(second, seen)).toBe(true);
  });

  it("updates active conversations but only toasts once for inactive conversations", () => {
    const event = { type: "message", dedupeKey: "message:m-4", conversationId: "c-2" };
    expect(isActiveConversation("/messages/c-2", "c-2")).toBe(true);
    expect(isActiveConversation("/messages", "c-2")).toBe(false);
    expect(isActiveConversation("/seller/messages/c-2/", "c-2")).toBe(true);
    expect(isActiveConversation("/seller/messages", "c-2")).toBe(false);
    expect(isActiveConversation("/admin/messages/c-2", "c-2")).toBe(true);
    expect(isActiveConversation("/admin/messages", "c-2")).toBe(false);
    expect(isActiveConversation("/messages/c-other", "c-2")).toBe(false);
    expect(shouldShowIncomingToast(event, "/messages/c-1")).toBe(true);
    expect(shouldShowIncomingToast(event, "/messages/c-2")).toBe(false);
    expect(shouldShowIncomingToast({ type: "notification", dedupeKey: "notification:n-1" }, "/messages/c-1")).toBe(true);
    expect(conversationSource).toContain("riezz99:realtime-message");
    expect(conversationSource).toContain("syncMessages(true)");
    expect(conversationSource).toContain("router.refresh()");
    expect(conversationSource).toContain("riezz99:toast");
  });

  it("refreshes unread consumers for every accepted SSE event before toast filtering", () => {
    expect(providerSource).toContain('window.dispatchEvent(new CustomEvent("riezz99:realtime-unread"');
    expect(providerSource).toContain("current.some((toast) => toast.id === dedupeKey)");
  });

  it("keeps message reads uncached and cleans realtime listeners on unmount", () => {
    expect(messageRoute).toContain('"Cache-Control": "no-store, max-age=0"');
    expect(conversationSource).toContain('{ cache: "no-store" }');
    expect(conversationSource).toContain("window.removeEventListener(\"riezz99:realtime-message\", onRealtimeMessage)");
    expect(streamRoute).toContain("request.signal.addEventListener(\"abort\", cleanup");
    expect(streamRoute).toContain("unsubscribe();");
  });

  it("keeps send failures on the shared toast channel", () => {
    expect(conversationSource).toContain("Gagal mengirim pesan. Coba lagi.");
    expect(conversationSource).toContain("new CustomEvent<ToastRequest>(\"riezz99:toast\"");
  });

  it("refreshes sender UI after successful POST without inserting twice", () => {
    expect(conversationSource).toContain("reconcileOptimisticMessage(current, optimisticId, data.message)");
    expect(conversationSource).toContain("messagesRef.current = reconcileOptimisticMessage(messagesRef.current, optimisticId, data.message)");
    expect(conversationSource).toContain("router.refresh()");
  });

  it("does not refresh the conversation for heartbeat or notification events", () => {
    expect(providerSource).not.toContain('source.addEventListener("ping"');
    expect(providerSource).toContain('if (payload.type === "message") window.dispatchEvent');
    expect(providerSource).toContain("shouldShowIncomingToast(payload");
    expect(providerSource).toContain('source.addEventListener("read-receipt", onEvent)');
    expect(providerSource).toContain('"riezz99:realtime-read-receipt"');
  });

  it("keeps one EventSource across router refreshes", () => {
    expect(providerSource).toContain('new EventSource("/api/realtime/stream")');
    expect(providerSource).toContain("}, [enabled]);");
    expect(providerSource).not.toContain("window.location.reload");
  });

  it("synchronizes after reconnect and browser lifecycle changes", () => {
    expect(providerSource).toContain('source.addEventListener("ready", onReady)');
    expect(providerSource).toContain('new CustomEvent("riezz99:realtime-sync"');
    expect(providerSource).toContain('window.addEventListener("visibilitychange", onVisibility)');
    expect(providerSource).toContain('window.addEventListener("focus", onFocus)');
    expect(providerSource).toContain('window.addEventListener("online", onOnline)');
    expect(conversationSource).toContain("15000");
    expect(notificationSource()).toContain("15000");
  });

  it("keeps storage failures and local pending messages out of recovery cursors", () => {
    expect(providerSource).toContain("sessionStorage.setItem(seenKey");
    expect(providerSource).toContain("Storage can be disabled or full");
    expect(conversationSource).toContain('message.status !== "sending" && message.status !== "failed"');
    expect(conversationSource).toContain('message.status === "sending" || message.status === "failed"');
  });

  it("routes buyer-seller notifications to the actual participant", () => {
    expect(messageRoute).toContain('conversation.adminSupport ? "admin"');
    expect(messageRoute).toContain('session.user.role === "SELLER" ? "customer"');
    expect(messageRoute).toContain('conversation.seller ? "seller" : "admin"');
  });

  it("keeps media notifications descriptive without private media URLs", () => {
    expect(messageRoute).toContain("Ada gambar atau video baru di chat Riezz99.");
    expect(messageRoute).toContain("hasAttachments: attachmentIds.length > 0");
    expect(providerSource).not.toContain("/attachments/");
  });
});
