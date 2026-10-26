import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishNotification } from "@/lib/realtime/publish";

export const broadcastInput = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2000),
  targetAudience: z.enum(["ALL", "CUSTOMER", "SELLER"]),
  link: z.string().trim().max(500).refine((value) => value === "" || (value.startsWith("/") && !value.startsWith("//")), "Link harus berupa path internal.").optional().or(z.literal("")),
}).transform((data) => ({ ...data, link: data.link || null }));

export const notificationActionInput = z.object({ id: z.string().cuid().optional() });

export function targetRoleWhere(targetAudience: "ALL" | "CUSTOMER" | "SELLER"): Prisma.UserWhereInput {
  return targetAudience === "ALL" ? { role: { in: ["CUSTOMER", "SELLER"] } } : { role: targetAudience };
}

export async function createBroadcast(input: z.infer<typeof broadcastInput>, createdById: string) {
  const result = await prisma.$transaction(async (tx) => {
    const recipients = await tx.user.findMany({ where: targetRoleWhere(input.targetAudience), select: { id: true } });
    const broadcast = await tx.broadcast.create({
      data: { ...input, recipientCount: recipients.length, createdById },
    });
    const notifications = recipients.length ? await Promise.all(recipients.map(({ id }) => tx.notification.create({ data: { userId: id, title: input.title, message: input.message, type: "BROADCAST", link: input.link } }))) : [];
    await tx.auditLog.create({
      data: { actorId: createdById, action: "BROADCAST_SENT", entityType: "Broadcast", entityId: broadcast.id, metadata: { targetAudience: input.targetAudience, recipientCount: recipients.length } },
    });
    return { broadcast, notifications };
  });
  await Promise.all(result.notifications.map(publishNotification));
  return result.broadcast;
}
