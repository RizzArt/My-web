import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret, hashDownloadToken } from "@/lib/security/secrets";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;
  const now = Date.now();
  const rate = attempts.get(session.user.id);
  if (rate && rate.resetAt > now && rate.count >= 30) return NextResponse.json({ error: "Too many downloads" }, { status: 429 });
  attempts.set(session.user.id, { count: rate && rate.resetAt > now ? rate.count + 1 : 1, resetAt: now + 60_000 });
  const delivery = await prisma.digitalDelivery.findUnique({ where: { downloadTokenHash: hashDownloadToken(token) }, include: { order: true, inventory: true } });
  if (!delivery || delivery.type !== "FILE" || delivery.order.userId !== session.user.id || delivery.order.status !== "PAID") return NextResponse.json({ error: "Download not found" }, { status: 404 });
  if (!delivery.downloadExpiresAt || delivery.downloadExpiresAt.getTime() <= now) return NextResponse.json({ error: "Download link expired" }, { status: 410 });
  if (delivery.maxDownloads !== null && delivery.downloadCount >= delivery.maxDownloads) return NextResponse.json({ error: "Download limit reached" }, { status: 410 });
  const claimed = await prisma.digitalDelivery.updateMany({ where: { id: delivery.id, downloadCount: delivery.downloadCount }, data: { downloadCount: { increment: 1 } } });
  if (claimed.count !== 1) return NextResponse.json({ error: "Please retry" }, { status: 409 });
  const configuredRoot = path.resolve(process.env.DIGITAL_STORAGE_ROOT ?? path.join(process.cwd(), "storage"));
  const filePath = path.resolve(configuredRoot, decryptSecret(delivery.valueEncrypted ?? delivery.inventory?.secretValue ?? ""));
  if (filePath !== configuredRoot && !filePath.startsWith(`${configuredRoot}${path.sep}`)) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  try {
    const file = await readFile(filePath);
    return new NextResponse(file, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
