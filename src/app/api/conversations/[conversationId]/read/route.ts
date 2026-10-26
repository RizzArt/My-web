import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessConversation, conversationDeleteField } from "@/lib/chat";
import { publishReadReceipt } from "@/lib/realtime/publish";

const readInput = z.object({
  messageIds: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
});

async function getConversation(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    include: { seller: { select: { userId: true } } },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(conversation, session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Daftar pesan yang dibaca tidak valid." }, { status: 400 }); }
  const parsed = readInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Daftar pesan yang dibaca tidak valid." }, { status: 400 });
  const messageIds = [...new Set(parsed.data.messageIds)];
  if (!messageIds.length) return NextResponse.json({ error: "Daftar pesan yang dibaca tidak valid." }, { status: 400 });

  const cutoff = conversation[conversationDeleteField(session.user.role)];
  const readAt = new Date();
  const readMessages = await prisma.message.updateManyAndReturn({
    where: {
      conversationId,
      id: { in: messageIds },
      senderId: { not: session.user.id },
      readAt: null,
      ...(cutoff ? { createdAt: { gt: cutoff } } : {}),
    },
    data: { isRead: true, readAt },
    select: { id: true, senderId: true },
  });

  if (readMessages.length) {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, conversationId, type: "CHAT", isRead: false },
      data: { isRead: true },
    });
    const bySender = new Map<string, string[]>();
    for (const message of readMessages) bySender.set(message.senderId, [...(bySender.get(message.senderId) ?? []), message.id]);
    await Promise.all([...bySender].map(([recipientId, ids]) => publishReadReceipt({ recipientId, conversationId, messageIds: ids, readAt })));
  }

  return NextResponse.json({ readMessageIds: readMessages.map((message) => message.id), readAt: readMessages.length ? readAt.toISOString() : null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
