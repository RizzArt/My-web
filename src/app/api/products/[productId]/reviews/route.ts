import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { reviewInput } from "@/lib/reviews";

export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const reviews = await prisma.productReview.findMany({ where: { productId }, orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { name: true } } } });
  return NextResponse.json({ reviews: reviews.map((review) => ({ ...review, user: undefined, reviewer: review.user.name || "Pembeli", createdAt: review.createdAt.toISOString() })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Silakan masuk untuk memberi ulasan." }, { status: 401 });
  const { productId } = await params;
  const parsed = reviewInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ulasan tidak valid." }, { status: 400 });
  const item = await prisma.orderItem.findFirst({ where: { id: parsed.data.orderItemId, productId, order: { userId: session.user.id, OR: [{ status: "COMPLETED" }, { payment: { status: "PAID" } }] } }, include: { product: { select: { seller: { select: { userId: true } } } } } });
  if (!item) return NextResponse.json({ error: "Kamu hanya dapat mengulas produk yang sudah dibeli dan dibayar." }, { status: 403 });
  if (item.product.seller?.userId === session.user.id) return NextResponse.json({ error: "Seller tidak dapat mengulas produknya sendiri." }, { status: 403 });
  try {
    const review = await prisma.productReview.create({ data: { productId, orderItemId: item.id, userId: session.user.id, rating: parsed.data.rating, comment: parsed.data.comment || null } });
    return NextResponse.json({ review }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Order item ini sudah memiliki ulasan." }, { status: 409 });
  }
}
