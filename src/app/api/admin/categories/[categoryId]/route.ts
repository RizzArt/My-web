import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const categoryInput = z.object({ name: z.string().trim().min(2).max(120) });
async function admin() { const session = await auth(); return session?.user.role === "ADMIN" ? session : null; }

export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  if (!await admin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = categoryInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nama kategori tidak valid." }, { status: 400 });
  try { const category = await prisma.category.update({ where: { id: (await params).categoryId }, data: { name: parsed.data.name } }); return NextResponse.json({ category }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error && "code" in error && error.code === "P2002" ? "Slug kategori sudah digunakan." : "Kategori tidak ditemukan atau gagal disimpan." }, { status: 400 }); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  if (!await admin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = (await params).categoryId;
  const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!category) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 404 });
  if (category._count.products > 0) return NextResponse.json({ error: "Kategori masih dipakai produk. Nonaktifkan saja." }, { status: 409 });
  await prisma.category.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
