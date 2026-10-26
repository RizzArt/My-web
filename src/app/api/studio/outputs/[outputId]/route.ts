import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readStudioFile } from "@/lib/studio/storage";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ outputId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { outputId } = await params;
  const output = await prisma.studioGenerationOutput.findFirst({ where: { id: outputId, generation: { userId: session.user.id, deletedAt: null } } });
  if (!output) return new NextResponse("Not found", { status: 404 });
  try { const data = await readStudioFile(output.storageKey); const download = new URL(request.url).searchParams.get("download") === "1"; return new NextResponse(data, { headers: { "Content-Type": output.mimeType, "Content-Disposition": `${download ? "attachment" : "inline"}; filename="riezz99-ai-${output.id}.${output.mimeType === "image/png" ? "png" : output.mimeType === "image/webp" ? "webp" : "jpg"}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return new NextResponse("Not found", { status: 404 }); }
}
