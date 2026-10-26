import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessConversation } from "@/lib/chat";
import { getChatMediaFileInfo, resolveChatMediaPath } from "@/lib/storage/chat-media";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string; attachmentId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { conversationId, attachmentId } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { seller: { select: { userId: true } } } });
  if (!conversation || !canAccessConversation(conversation, session.user)) return new NextResponse("Forbidden", { status: 403 });
  const attachment = await prisma.chatAttachment.findFirst({ where: { id: attachmentId, conversationId, messageId: { not: null } } });
  if (!attachment) return new NextResponse("Not found", { status: 404 });
  const filePath = resolveChatMediaPath(attachment.storageKey);
  const mediaInfo = getChatMediaFileInfo(attachment.storageKey, attachment.mimeType);
  if (!filePath || !mediaInfo) return new NextResponse("Not found", { status: 404 });
  try {
    const file = await readFile(filePath);
    const headers = { "Content-Type": mediaInfo.mimeType, "Content-Disposition": `inline; filename="attachment.${mediaInfo.extension}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
    const range = request.headers.get("range");
    if (range?.startsWith("bytes=")) {
      const [startText, endText] = range.slice(6).split("-", 2);
      const start = Number(startText);
      const end = endText ? Number(endText) : file.length - 1;
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end < file.length) {
        return new NextResponse(file.subarray(start, end + 1), { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${file.length}` } });
      }
      return new NextResponse("Range Not Satisfiable", { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.length}` } });
    }
    return new NextResponse(file, { headers: { ...headers, "Content-Length": String(file.length) } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
