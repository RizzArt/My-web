import type { Notification } from "@prisma/client";
import { publishToUser } from "./event-bus";
import { enqueuePush, drainPushQueue } from "@/lib/push/server";

export async function publishNotification(notification: Pick<Notification, "id" | "userId" | "title" | "message" | "link" | "createdAt" | "type">) {
  try {
    const event = publishToUser(notification.userId, { type: "notification", title: notification.title, body: notification.message, href: notification.link ?? undefined, notificationId: notification.id, dedupeKey: `notification:${notification.id}`, createdAt: notification.createdAt.toISOString() });
    await enqueuePush({ userId: notification.userId, dedupeKey: `notification:${notification.id}`, link: notification.link ?? "/", title: "Notifikasi Riezz99", body: "Ada aktivitas baru di akun kamu.", data: { type: notification.type ?? "notification" } });
    if (process.env.PUSH_DEFER_DISPATCH !== "true") void drainPushQueue(5).catch((error) => console.error("Push notification dispatch failed", error instanceof Error ? error.message : "unknown error"));
    return event;
  } catch (error) {
    console.error("Realtime notification publish failed", error);
    return null;
  }
}

export async function publishMessage(input: { recipientId: string; messageId: string; conversationId: string; href: string; createdAt: Date; title?: string; hasAttachments?: boolean }) {
  try {
    const body = input.hasAttachments ? "Ada gambar atau video baru di chat." : "Ada pesan baru. Buka aplikasi untuk melihatnya.";
    const event = publishToUser(input.recipientId, { type: "message", title: input.title ?? "Pesan baru", ...(input.hasAttachments ? { body } : {}), href: input.href, messageId: input.messageId, conversationId: input.conversationId, dedupeKey: `message:${input.messageId}`, createdAt: input.createdAt.toISOString() });
    await enqueuePush({ userId: input.recipientId, dedupeKey: `message:${input.messageId}`, link: input.href, title: "Pesan baru di Riezz99", body, data: { type: "message", conversationId: input.conversationId } });
    if (process.env.PUSH_DEFER_DISPATCH !== "true") void drainPushQueue(5).catch((error) => console.error("Push message dispatch failed", error instanceof Error ? error.message : "unknown error"));
    return event;
  } catch (error) {
    console.error("Realtime message publish failed", error);
    return null;
  }
}

export function publishReadReceipt(input: { recipientId: string; conversationId: string; messageIds: string[]; readAt: Date }) {
  try {
    const messageIds = [...new Set(input.messageIds)].sort();
    if (!messageIds.length) return null;
    return publishToUser(input.recipientId, {
      type: "read-receipt",
      conversationId: input.conversationId,
      messageIds,
      readAt: input.readAt.toISOString(),
      dedupeKey: `read:${input.conversationId}:${messageIds.join(",")}:${input.readAt.toISOString()}`,
    });
  } catch (error) {
    console.error("Realtime read receipt publish failed", error);
    return null;
  }
}
