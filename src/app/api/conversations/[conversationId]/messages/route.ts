import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessConversation, cleanOptionalMessage, conversationDeleteField, getSupportAdmin } from "@/lib/chat";
import { CHAT_MAX_ATTACHMENTS } from "@/lib/storage/chat-media";
import { publishMessage } from "@/lib/realtime/publish";

async function getConversation(id: string) { return prisma.conversation.findUnique({ where: { id }, include: { seller: { select: { userId: true, storeName: true } } } }); }
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await params; const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(conversation, session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const cutoff = conversation[conversationDeleteField(session.user.role)];
  const visibleWhere = cutoff ? { createdAt: { gt: cutoff } } : {};
  const url = new URL(request.url);
  const afterCreatedAt = url.searchParams.get("afterCreatedAt");
  const afterId = url.searchParams.get("afterId");
  let cursorWhere: { OR?: Array<{ createdAt: { gt: Date } } | { createdAt: Date; id: { gt: string } }> } = {};
  if (afterCreatedAt) {
    const date = new Date(afterCreatedAt);
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "Cursor pesan tidak valid." }, { status: 400 });
    cursorWhere = { OR: [{ createdAt: { gt: date } }, ...(afterId ? [{ createdAt: date, id: { gt: afterId } }] : [])] };
  }
  const messages = await prisma.message.findMany({ where: { conversationId, ...visibleWhere, ...cursorWhere }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, senderId: true, content: true, readAt: true, createdAt: true, sender: { select: { name: true, role: true } }, attachments: { select: { id: true, kind: true, mimeType: true, byteSize: true } } } });
  return NextResponse.json({ conversation, messages, historyClearedAt: cutoff?.toISOString() ?? null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await params; const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(conversation, session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { content?: unknown; attachmentIds?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Isi pesan tidak valid." }, { status: 400 }); }
  let content: string;
  let attachmentIds: string[];
  try {
    content = cleanOptionalMessage(body.content);
    if (body.attachmentIds !== undefined && (!Array.isArray(body.attachmentIds) || !body.attachmentIds.every((id) => typeof id === "string"))) throw new Error("Daftar lampiran tidak valid.");
    attachmentIds = Array.isArray(body.attachmentIds) ? [...new Set(body.attachmentIds)] : [];
    if (attachmentIds.length > CHAT_MAX_ATTACHMENTS) throw new Error("Maksimal 4 lampiran per pesan.");
    if (!content && !attachmentIds.length) throw new Error("Pesan harus berisi teks atau lampiran.");
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Pesan tidak valid." }, { status: 400 }); }
  try {
    const result = await prisma.$transaction(async (tx) => {
    const attachments = attachmentIds.length ? await tx.chatAttachment.findMany({ where: { id: { in: attachmentIds }, conversationId, uploadedById: session.user.id, messageId: null }, select: { id: true } }) : [];
    if (attachments.length !== attachmentIds.length) throw new Error("Salah satu lampiran tidak valid atau sudah digunakan.");
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId: session.user.id,
        content,
        ...(attachmentIds.length ? { attachments: { connect: attachmentIds.map((id) => ({ id })) } } : {}),
      },
      include: { attachments: { select: { id: true, kind: true, mimeType: true, byteSize: true } } },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    const senderIsAdmin = session.user.role === "ADMIN";
    const recipientId = senderIsAdmin ? (conversation.seller?.userId ?? conversation.customerId) : conversation.adminSupport ? (await getSupportAdmin(tx))?.id : session.user.role === "SELLER" ? conversation.customerId : conversation.seller?.userId;
    if (!recipientId) return { created, notifications: [], title: undefined, hasAttachments: attachmentIds.length > 0 };
    const recipientPath = senderIsAdmin ? (conversation.seller ? "seller" : "customer") : conversation.adminSupport ? "admin" : session.user.role === "SELLER" ? "customer" : conversation.seller ? "seller" : "admin";
    const senderName = senderIsAdmin ? "Admin Riezz99" : session.user.role === "SELLER" ? conversation.seller?.storeName ?? session.user.name ?? "Seller" : session.user.name ?? "Buyer";
    const title = `Pesan baru dari ${senderName}`;
    const message = attachmentIds.length ? "Ada gambar atau video baru di chat Riezz99." : senderIsAdmin ? "Admin Riezz99 membalas chat kamu." : "Ada pesan baru untuk support.";
    const link = recipientPath === "admin" ? `/admin/messages/${conversationId}` : recipientPath === "seller" ? `/seller/messages/${conversationId}` : `/messages/${conversationId}`;
    const notification = await tx.notification.create({ data: { userId: recipientId, conversationId, title, message, type: "CHAT", link } });
    return { created, notifications: [notification], title, hasAttachments: attachmentIds.length > 0 };
    });
    await Promise.all(result.notifications.map((notification) => publishMessage({ recipientId: notification.userId, messageId: result.created.id, conversationId, title: result.title, href: notification.link ?? `/messages/${conversationId}`, createdAt: result.created.createdAt, hasAttachments: result.hasAttachments })));
    return NextResponse.json({ message: result.created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pesan gagal dikirim." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await params;
  const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(conversation, session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.conversation.update({ where: { id: conversationId }, data: { [conversationDeleteField(session.user.role)]: new Date() } });
  await prisma.notification.updateMany({ where: { userId: session.user.id, conversationId, type: "CHAT" }, data: { isRead: true } });
  return NextResponse.json({ ok: true });
}
