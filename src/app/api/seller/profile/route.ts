import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const input = z.object({ storeName: z.string().trim().min(2).max(120), description: z.string().trim().max(2000), logoUrl: z.string().regex(/^\/uploads\/stores\/[a-f0-9-]+\.webp$/).nullable().optional(), bannerUrl: z.string().regex(/^\/uploads\/stores\/[a-f0-9-]+\.webp$/).nullable().optional() });

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SELLER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Profil toko tidak valid." }, { status: 400 });
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!seller) return NextResponse.json({ error: "Profil seller tidak ditemukan." }, { status: 404 });
  const updated = await prisma.sellerProfile.update({ where: { id: seller.id }, data: { storeName: parsed.data.storeName, description: parsed.data.description, ...(parsed.data.logoUrl !== undefined ? { logoUrl: parsed.data.logoUrl } : {}), ...(parsed.data.bannerUrl !== undefined ? { bannerUrl: parsed.data.bannerUrl } : {}) }, select: { storeName: true, storeSlug: true, description: true, logoUrl: true, bannerUrl: true } });
  return NextResponse.json({ seller: updated });
}
