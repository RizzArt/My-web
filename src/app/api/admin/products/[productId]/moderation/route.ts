import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { moderateSellerProduct } from "@/lib/product-moderation";
import { publishNotification } from "@/lib/realtime/publish";
const input = z.object({ status: z.enum(["APPROVED", "REJECTED"]), rejectionReason: z.string().trim().max(1000).optional() });
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.status === "REJECTED" && !parsed.data.rejectionReason)) return NextResponse.json({ error: "Alasan reject wajib diisi." }, { status: 400 });
  const { productId } = await params;
  try {
    const product = await prisma.$transaction(async (tx) => {
      return moderateSellerProduct(tx, {
        productId,
        actorId: session.user.id,
        status: parsed.data.status,
        rejectionReason: parsed.data.rejectionReason,
      });
    });
    if (!product) return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
    await publishNotification(product.notification);
    return NextResponse.json({ product });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Moderation gagal." }, { status: 400 });
  }
}
