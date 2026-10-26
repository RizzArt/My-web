import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessConversation } from "@/lib/chat";
import { deleteChatMedia } from "@/lib/storage/chat-media";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ conversationId: string; attachmentId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId, attachmentId } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { seller: { select: { userId: true } } } });
  if (!conversation || !canAccessConversation(conversation, session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const attachment = await prisma.chatAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.conversationId !== conversationId || attachment.uploadedById !== session.user.id) return NextResponse.json({ error: "Lampiran tidak ditemukan." }, { status: 404 });
  if (attachment.messageId) return NextResponse.json({ error: "Lampiran yang sudah dikirim tidak dapat dihapus." }, { status: 409 });
  await prisma.chatAttachment.delete({ where: { id: attachment.id } });
  await deleteChatMedia(attachment.storageKey);
  return NextResponse.json({ ok: true });
}
