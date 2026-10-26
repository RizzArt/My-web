import { activeSellerProductWhere } from "@/lib/product-account-visibility";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { conversationDeleteField, getSupportAdmin } from "@/lib/chat";

const createInput = z.object({ productId: z.string().min(1).optional(), sellerId: z.string().min(1).optional(), adminSupport: z.boolean().optional().default(false) }).refine((data) => Boolean(data.productId || data.sellerId || data.adminSupport), "Produk, seller, atau support wajib dipilih.");

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const where = session.user.role === "ADMIN"
    ? { adminSupport: true }
    : session.user.role === "SELLER"
      ? { seller: { userId: session.user.id } }
      : { customerId: session.user.id };
  const candidates = await prisma.conversation.findMany({ where, orderBy: { updatedAt: "desc" }, include: { product: { select: { name: true, thumbnailUrl: true } }, seller: { select: { storeName: true, userId: true } }, customer: { select: { name: true, role: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true, senderId: true, attachments: { select: { kind: true } } } } } });
  const deleteField = conversationDeleteField(session.user.role);
  const conversations = candidates.flatMap((conversation) => {
    const cutoff = conversation[deleteField];
    const messages = conversation.messages.filter(
      (message) => !cutoff || message.createdAt.getTime() > cutoff.getTime()
    );
    if (cutoff && !messages.length) return [];
    return [{ ...conversation, messages }];
  });
  const unreadCounts = conversations.length ? await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      OR: conversations.map((conversation) => ({
        conversationId: conversation.id,
        ...(conversation[deleteField]
          ? { createdAt: { gt: conversation[deleteField]! } } : {}),
      })),
      senderId: { not: session.user.id },
      isRead: false,
    },
    _count: { _all: true },
  }) : [];
  const unreadByConversation = new Map(unreadCounts.map((item) => [item.conversationId, item._count._all]));
  return NextResponse.json({ conversations: conversations.map((conversation) => ({ ...conversation, unreadCount: unreadByConversation.get(conversation.id) ?? 0 })) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Silakan masuk untuk memulai chat." }, { status: 401 });
  const parsed = createInput.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Produk chat tidak valid." }, { status: 400 });
  if (parsed.data.adminSupport && session.user.role === "ADMIN" && !parsed.data.sellerId) return NextResponse.json({ error: "Admin harus memilih seller tujuan." }, { status: 400 });
  if (parsed.data.adminSupport && session.user.role !== "CUSTOMER" && session.user.role !== "SELLER" && session.user.role !== "ADMIN") return NextResponse.json({ error: "Role tidak dapat membuka chat support." }, { status: 403 });
  if (parsed.data.adminSupport && session.user.role === "CUSTOMER" && parsed.data.sellerId) return NextResponse.json({ error: "Customer tidak dapat menentukan peserta admin." }, { status: 403 });
  const product = parsed.data.productId ? await prisma.product.findFirst({ where: { id: parsed.data.productId, isPublished: true, moderationStatus: "APPROVED", ...activeSellerProductWhere() }, select: { id: true, sellerId: true } }) : null;
  const seller = parsed.data.sellerId ? await prisma.sellerProfile.findFirst({ where: { id: parsed.data.sellerId, isActive: true, user: { isActive: true, role: "SELLER" } }, select: { id: true } }) : null;
  if (parsed.data.productId && !product) return NextResponse.json({ error: "Produk tidak tersedia." }, { status: 404 });
  if (parsed.data.sellerId && !seller) return NextResponse.json({ error: "Seller tidak tersedia." }, { status: 404 });
  if (parsed.data.sellerId && session.user.role === "SELLER") return NextResponse.json({ error: "Seller tidak dapat chat dirinya sendiri." }, { status: 403 });
  if (session.user.role === "ADMIN" && !parsed.data.adminSupport) return NextResponse.json({ error: "Admin hanya dapat membuka chat support." }, { status: 403 });
  const sellerId = seller?.id ?? product?.sellerId ?? null;
  const adminSupport = parsed.data.adminSupport || !sellerId;
  const supportSellerId = adminSupport && session.user.role === "SELLER" ? (await prisma.sellerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }))?.id ?? null : null;
  if (adminSupport && session.user.role === "SELLER" && !supportSellerId) return NextResponse.json({ error: "Profil seller tidak ditemukan." }, { status: 403 });
  if (adminSupport && session.user.role === "ADMIN" && !sellerId) return NextResponse.json({ error: "Seller tujuan tidak ditemukan." }, { status: 404 });
  if (adminSupport && !(await getSupportAdmin(prisma))) return NextResponse.json({ error: "Admin support belum tersedia." }, { status: 503 });
  if (!adminSupport && session.user.role === "SELLER") return NextResponse.json({ error: "Seller tidak dapat membuka chat customer." }, { status: 403 });
  const supportSeller = supportSellerId ? { id: supportSellerId } : null;
  let conversation;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      conversation = await prisma.$transaction(async (tx) => {
        const existing = await tx.conversation.findFirst({ where: { customerId: session.user.id, sellerId: adminSupport ? (session.user.role === "ADMIN" ? sellerId : supportSeller?.id ?? null) : sellerId, adminSupport } });
        return existing
          ? existing
          : tx.conversation.create({ data: { customerId: session.user.id, productId: adminSupport ? null : product?.id ?? null, sellerId: adminSupport ? (session.user.role === "ADMIN" ? sellerId : supportSeller?.id ?? null) : sellerId, adminSupport } });
      }, { isolationLevel: "Serializable" });
      break;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2034") || attempt === 2) throw error;
    }
  }
  if (!conversation) return NextResponse.json({ error: "Chat belum dapat dibuka. Silakan coba lagi." }, { status: 409 });
  return NextResponse.json({ conversationId: conversation.id });
}
