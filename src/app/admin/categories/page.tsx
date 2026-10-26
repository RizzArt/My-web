import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/admin-page";
import { CategoryManager } from "@/components/category-manager";
export const dynamic = "force-dynamic";
export default async function AdminCategoriesPage() { await requireAdmin(); const categories = await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } }); return <main className="mx-auto max-w-5xl px-5 py-12 sm:py-20"><AdminPageHeader eyebrow="Catalog" title="Categories" summary="Tambah, ubah, aktifkan, atau nonaktifkan kategori." backHref="/admin"/><CategoryManager initialCategories={categories}/></main>; }
