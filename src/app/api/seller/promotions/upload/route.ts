import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageProvider } from "@/lib/storage/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user.id || session.user.role !== "SELLER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true, isActive: true } });
  if (!seller?.isActive) return NextResponse.json({ error: "Profil seller tidak aktif." }, { status: 403 });
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "File banner wajib dipilih." }, { status: 400 });
  try {
    // Use the existing image provider and its 5 MB/WebP/safe filename rules.
    const url = await getStorageProvider().saveProductImage(file, "gallery");
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Banner gagal diupload." }, { status: 400 });
  }
}
