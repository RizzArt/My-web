import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishNotification } from "@/lib/realtime/publish";

type AdminEvent = {
  eventKey: string;
  title: string;
  message: string;
  link: string;
};

export function adminNotificationId(eventKey: string, userId: string) {
  return "c" + createHash("sha256")
    .update(JSON.stringify([eventKey, userId]))
    .digest("hex").slice(0, 24);
}

async function createAdminNotifications(
  tx: Prisma.TransactionClient, event: AdminEvent
) {
  if (!event.link.startsWith("/admin/")) {
    throw new Error("Link notifikasi admin tidak valid.");
  }
  const admins = await tx.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (!admins.length) return [];
  const rows = admins.map((admin) => ({
    id: adminNotificationId(event.eventKey, admin.id),
    userId: admin.id,
    title: event.title,
    message: event.message,
    type: "ADMIN_ACTIVITY",
    link: event.link,
  }));
  await tx.notification.createMany({ data: rows, skipDuplicates: true });
  const notifications = await tx.notification.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  await tx.pushJob.createMany({
    data: notifications.map((notification) => ({
      userId: notification.userId,
      dedupeKey: `notification:${notification.id}`,
      title: "Aktivitas Admin Riezz99",
      body: "Ada aktivitas baru yang perlu ditinjau admin.",
      link: notification.link ?? "/admin",
      data: { type: "ADMIN_ACTIVITY" },
    })),
    skipDuplicates: true,
  });
  return notifications;
}

export async function adminNotifiedTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  eventForResult: (result: T) => AdminEvent | null,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
): Promise<T> {
  const committed = await prisma.$transaction(async (tx) => {
    const result = await operation(tx);
    const event = eventForResult(result);
    const notifications = event
      ? await createAdminNotifications(tx, event) : [];
    return { result, notifications };
  }, options);
  // Publish only after commit. The inbox and push jobs are already durable.
  await Promise.all(committed.notifications.map(async (notification) => {
    try {
      await publishNotification(notification);
    } catch {
      console.error("Admin notification realtime dispatch failed");
    }
  }));
  return committed.result;
}

export async function notifyAdmins(event: AdminEvent) {
  try {
    await adminNotifiedTransaction(async () => null, () => event);
  } catch {
    console.error("Admin activity notification persistence failed");
  }
}
