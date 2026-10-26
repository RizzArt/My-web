import { normalizeSlug } from "@/lib/seller";
import type { Prisma } from "@prisma/client";

export async function uniqueProductSlug(tx: { product: { findFirst: (args: Prisma.ProductFindFirstArgs) => Promise<{ id: string } | null> } }, name: string, currentId?: string) {
  const base = normalizeSlug(name) || "product";
  let slug = base;
  let suffix = 2;
  while (await tx.product.findFirst({ where: { slug, ...(currentId ? { id: { not: currentId } } : {}) }, select: { id: true } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}
