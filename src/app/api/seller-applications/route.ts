import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { normalizeSlug, RESERVED_SLUGS } from "@/lib/seller";

const input = z.object({
  storeName: z.string().trim().min(2).max(120), storeSlug: z.string().trim().max(60).optional(),
  description: z.string().trim().min(10).max(2000), email: z.string().email(), phone: z.string().trim().min(6).max(40),
  businessType: z.string().trim().min(2).max(80), website: z.string().url().optional().or(z.literal("")),
  socialMedia: z.string().max(300).optional(), notes: z.string().max(1000).optional(), identityName: z.string().max(120).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "CUSTOMER") return NextResponse.json({ error: "Akun ini tidak dapat mengajukan seller." }, { status: 400 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data seller tidak valid.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const data = parsed.data;
  const baseSlug = normalizeSlug(data.storeSlug || data.storeName);
  if (!baseSlug || RESERVED_SLUGS.has(baseSlug)) return NextResponse.json({ error: "Nama toko menghasilkan slug yang tidak tersedia." }, { status: 400 });
  let storeSlug = baseSlug; let suffix = 2;
  while (await prisma.sellerProfile.findUnique({ where: { storeSlug }, select: { id: true } }) || await prisma.sellerApplication.findFirst({ where: { storeSlug, status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } })) { storeSlug = `${baseSlug.slice(0, 57)}-${suffix}`; suffix += 1; }
  const [pending, existingProfile, existingSlug] = await Promise.all([
    prisma.sellerApplication.findFirst({ where: { userId: session.user.id, status: "PENDING" } }),
    prisma.sellerProfile.findUnique({ where: { userId: session.user.id } }),
    prisma.sellerProfile.findUnique({ where: { storeSlug } }),
  ]);
  if (pending || existingProfile) return NextResponse.json({ error: "Anda sudah memiliki pengajuan seller aktif." }, { status: 409 });
  if (existingSlug || await prisma.sellerApplication.findFirst({ where: { storeSlug, status: { in: ["PENDING", "APPROVED"] } } })) return NextResponse.json({ error: "Store slug sudah digunakan." }, { status: 409 });
  const application = await adminNotifiedTransaction(async (tx) => {
    const application = await tx.sellerApplication.create({
      data: { ...data, storeSlug, userId: session.user.id, website: data.website || null }
    });
    await tx.auditLog.create({ data: {
      actorId: session.user.id, action: "SELLER_APPLICATION_SUBMITTED",
      entityType: "SellerApplication", entityId: application.id
    } });
    return application;
  }, (result) => ({
    eventKey: `seller-application:${result.id}`,
    title: "Pengajuan Seller Baru",
    message: "Ada pengajuan seller baru yang menunggu persetujuan.",
    link: "/admin/sellers"
  }));
  return NextResponse.json({ application }, { status: 201 });
}
