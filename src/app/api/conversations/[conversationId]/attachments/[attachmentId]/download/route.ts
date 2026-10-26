import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessConversation } from "@/lib/chat";
import { getChatMediaDownloadFilename, getChatMediaFileInfo, resolveChatMediaPath } from "@/lib/storage/chat-media";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string; attachmentId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { conversationId, attachmentId } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { seller: { select: { userId: true } } } });
  if (!conversation || !canAccessConversation(conversation, session.user)) return new NextResponse("Forbidden", { status: 403 });
  const attachment = await prisma.chatAttachment.findFirst({ where: { id: attachmentId, conversationId, messageId: { not: null } } });
  if (!attachment) return new NextResponse("Not found", { status: 404 });
  const filePath = resolveChatMediaPath(attachment.storageKey);
  const mediaInfo = getChatMediaFileInfo(attachment.storageKey, attachment.mimeType);
  const filename = getChatMediaDownloadFilename(attachment.id, attachment.kind, attachment.storageKey);
  if (!filePath || !mediaInfo || !filename) return new NextResponse("Not found", { status: 404 });
  try {
    const file = await readFile(filePath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": mediaInfo.mimeType,
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(file.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
