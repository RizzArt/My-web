import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const rejectInput = z.object({ rejectionReason: z.string().trim().min(3).max(1000) });
export async function POST(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { applicationId } = await params; const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "REJECT") {
      const parsed = rejectInput.safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Alasan reject wajib diisi." }, { status: 400 });
      const application = await prisma.$transaction(async (tx) => { const item = await tx.sellerApplication.findUnique({ where: { id: applicationId } }); if (!item || item.status !== "PENDING") throw new Error("Application tidak tersedia."); const updated = await tx.sellerApplication.update({ where: { id: applicationId }, data: { status: "REJECTED", rejectionReason: parsed.data.rejectionReason, reviewedById: session.user.id, reviewedAt: new Date() } }); await tx.auditLog.create({ data: { actorId: session.user.id, action: "SELLER_APPLICATION_REJECTED", entityType: "SellerApplication", entityId: item.id, metadata: { rejectionReason: parsed.data.rejectionReason } } }); return updated; });
      return NextResponse.json({ application });
    }
    if (body.action !== "APPROVE") return NextResponse.json({ error: "Action tidak valid." }, { status: 400 });
    const application = await prisma.$transaction(async (tx) => {
      const item = await tx.sellerApplication.findUnique({ where: { id: applicationId } });
      if (!item) throw new Error("Application tidak ditemukan.");
      if (item.status === "REJECTED") throw new Error("Application sudah ditolak.");
      const profile = await tx.sellerProfile.upsert({ where: { userId: item.userId }, create: { userId: item.userId, storeName: item.storeName, storeSlug: item.storeSlug, description: item.description, phone: item.phone, email: item.email, isVerified: true }, update: { storeName: item.storeName, storeSlug: item.storeSlug, description: item.description, phone: item.phone, email: item.email, isVerified: true } });
      await tx.user.update({ where: { id: item.userId }, data: { role: "SELLER" } });
      if (item.status === "APPROVED") return item;
      const updated = await tx.sellerApplication.update({ where: { id: item.id }, data: { status: "APPROVED", reviewedById: session.user.id, reviewedAt: new Date(), rejectionReason: null } });
      await tx.auditLog.create({ data: { actorId: session.user.id, action: "SELLER_APPLICATION_APPROVED", entityType: "SellerApplication", entityId: item.id, metadata: { sellerProfileId: profile.id } } });
      return updated;
    });
    return NextResponse.json({ application });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal memproses application." }, { status: 400 }); }
}
