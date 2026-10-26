import type { Prisma } from "@prisma/client";
import { normalizeSlug } from "@/lib/seller";

type CategorySlugClient = {
  category: {
    findFirst: (args: Prisma.CategoryFindFirstArgs) => Promise<{ id: string } | null>;
  };
};

export async function uniqueCategorySlug(tx: CategorySlugClient, name: string, currentId?: string) {
  const base = normalizeSlug(name) || "category";
  let slug = base;
  let suffix = 2;

  while (await tx.category.findFirst({ where: { slug, ...(currentId ? { id: { not: currentId } } : {}) }, select: { id: true } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
}
