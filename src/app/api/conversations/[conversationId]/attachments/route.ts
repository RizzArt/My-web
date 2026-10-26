import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessConversation } from "@/lib/chat";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_UPLOAD_BYTES, CHAT_UPLOAD_RATE_BYTES, CHAT_UPLOAD_RATE_FILES, saveChatMedia, deleteChatMedia } from "@/lib/storage/chat-media";
import { prisma } from "@/lib/prisma";

async function getConversation(id: string) {
  return prisma.conversation.findUnique({ where: { id }, include: { seller: { select: { userId: true } } } });
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await params;
  const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(conversation, session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > CHAT_MAX_UPLOAD_BYTES + 512 * 1024) return NextResponse.json({ error: "File terlalu besar untuk diunggah." }, { status: 413 });
  const pendingCount = await prisma.chatAttachment.count({ where: { conversationId, uploadedById: session.user.id, messageId: null } });
  if (pendingCount >= CHAT_MAX_ATTACHMENTS) return NextResponse.json({ error: "Maksimal 4 lampiran per pesan." }, { status: 400 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Upload tidak dapat dibaca. Coba lagi." }, { status: 400 }); }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) return NextResponse.json({ error: "Pilih tepat satu file gambar atau video." }, { status: 400 });
  const recent = await prisma.chatAttachment.aggregate({ where: { uploadedById: session.user.id, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } }, _count: { _all: true }, _sum: { byteSize: true } });
  if (recent._count._all >= CHAT_UPLOAD_RATE_FILES || (recent._sum.byteSize ?? 0) + files[0].size > CHAT_UPLOAD_RATE_BYTES) return NextResponse.json({ error: "Batas upload sementara tercapai. Coba lagi beberapa menit lagi." }, { status: 429 });

  let stored: Awaited<ReturnType<typeof saveChatMedia>> | undefined;
  try {
    stored = await saveChatMedia(files[0]);
    const attachment = await prisma.chatAttachment.create({ data: { conversationId, uploadedById: session.user.id, storageKey: stored.storageKey, kind: stored.kind, mimeType: stored.mimeType, byteSize: stored.byteSize } });
    return NextResponse.json({ attachment: { id: attachment.id, kind: attachment.kind, mimeType: attachment.mimeType, byteSize: attachment.byteSize } }, { status: 201 });
  } catch (error) {
    if (stored) await deleteChatMedia(stored.storageKey);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lampiran gagal diunggah." }, { status: 400 });
  }
}
