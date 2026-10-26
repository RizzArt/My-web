import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStorageProvider, type ProductImageKind, type StoreImageKind } from "@/lib/storage/storage";

export const runtime = "nodejs";
// iPhone uploads can be slow on mobile networks; Nginx and the route use the
// same bounded window. The per-file 5 MiB limit is enforced by storage below.
export const maxDuration = 180;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "SELLER"].includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Request upload tidak valid." }, { status: 400 });
  const file = formData?.get("file");
  const kind = formData?.get("kind");
  const productId = formData?.get("productId");
  if (!(file instanceof File)) return NextResponse.json({ error: "File gambar wajib dipilih." }, { status: 400 });
  if (kind !== "thumbnail" && kind !== "gallery" && kind !== "logo" && kind !== "banner") return NextResponse.json({ error: "Jenis upload gambar tidak valid." }, { status: 400 });
  if (productId !== null && typeof productId !== "string") return NextResponse.json({ error: "Produk upload tidak valid." }, { status: 400 });
  if (kind === "logo" || kind === "banner") {
    if (session.user.role !== "SELLER") return NextResponse.json({ error: "Hanya seller yang dapat mengupload profil toko." }, { status: 403 });
    const seller = await prisma.sellerProfile.findFirst({ where: { userId: session.user.id, isActive: true }, select: { id: true } });
    if (!seller) return NextResponse.json({ error: "Profil seller tidak ditemukan." }, { status: 403 });
  } else if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId }, include: { seller: { select: { userId: true } } } });
    if (!product || (session.user.role === "SELLER" && product.seller?.userId !== session.user.id)) return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }
  try {
    const url = kind === "logo" || kind === "banner"
      ? await getStorageProvider().saveStoreImage(file, kind as StoreImageKind)
      : await getStorageProvider().saveProductImage(file, kind as ProductImageKind);
    return NextResponse.json({ url }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gambar gagal diupload." }, { status: 400 });
  }
}
