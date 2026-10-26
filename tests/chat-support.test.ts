import { describe, expect, it } from "vitest";
import { canAccessConversation, conversationDeleteField } from "@/lib/chat";
import { publishMessage } from "@/lib/realtime/publish";
import { subscribeUser } from "@/lib/realtime/event-bus";

describe("admin support chat policy", () => {
  const customerSupport = { customerId: "customer-1", sellerId: null, seller: null, adminSupport: true };
  const sellerSupport = { customerId: "seller-user-1", sellerId: "seller-1", seller: { userId: "seller-user-1" }, adminSupport: true };
  const buyerSeller = { customerId: "buyer-1", sellerId: "seller-1", seller: { userId: "seller-user-1" }, adminSupport: false };

  it("limits support conversations to the correct participant or an admin", () => {
    expect(canAccessConversation(customerSupport, { id: "customer-1", role: "CUSTOMER" })).toBe(true);
    expect(canAccessConversation(customerSupport, { id: "customer-2", role: "CUSTOMER" })).toBe(false);
    expect(canAccessConversation(sellerSupport, { id: "seller-user-1", role: "SELLER" })).toBe(true);
    expect(canAccessConversation(sellerSupport, { id: "seller-user-2", role: "SELLER" })).toBe(false);
    expect(canAccessConversation(customerSupport, { id: "admin-1", role: "ADMIN" })).toBe(true);
    expect(canAccessConversation(buyerSeller, { id: "buyer-1", role: "CUSTOMER" })).toBe(true);
    expect(canAccessConversation(buyerSeller, { id: "buyer-2", role: "CUSTOMER" })).toBe(false);
    expect(canAccessConversation(buyerSeller, { id: "admin-1", role: "ADMIN" })).toBe(false);
  });

  it("keeps soft-delete ownership separate for each participant type", () => {
    expect(conversationDeleteField("CUSTOMER")).toBe("customerDeletedAt");
    expect(conversationDeleteField("SELLER")).toBe("sellerDeletedAt");
    expect(conversationDeleteField("ADMIN")).toBe("adminDeletedAt");
  });

  it("publishes role-specific support toast titles to one recipient", () => {
    const events: Array<{ title: string; href?: string }> = [];
    const unsubscribe = subscribeUser("admin-1", (event) => events.push(event));
  publishMessage({ recipientId: "admin-1", messageId: "message-support-1", conversationId: "conversation-1", title: "Pesan baru dari Seller - Toko Satu", href: "/admin/messages/conversation-1", createdAt: new Date("2026-01-01") });
    unsubscribe();
    expect(events[0]).toMatchObject({ title: "Pesan baru dari Seller - Toko Satu", href: "/admin/messages/conversation-1" });
  });
});
