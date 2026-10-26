import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uniqueCategorySlug } from "@/lib/category-slug";

const categoryInput = z.object({ name: z.string().trim().min(2).max(120) });

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = categoryInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nama kategori tidak valid." }, { status: 400 });
  try {
    const category = await prisma.$transaction(async (tx) => tx.category.create({ data: { name: parsed.data.name, slug: await uniqueCategorySlug(tx, parsed.data.name) } }));
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error && "code" in error && error.code === "P2002" ? "Slug kategori sudah digunakan." : "Kategori gagal dibuat." }, { status: 400 }); }
}
