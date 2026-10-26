import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ["", "/products", "/about", "/contact", "/terms", "/privacy", "/refund-policy", "/faq"].map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.7 }));
  try {
    const [products, stores] = await Promise.all([
      prisma.product.findMany({ where: { isPublished: true, moderationStatus: "APPROVED" }, select: { slug: true, updatedAt: true } }),
      prisma.sellerProfile.findMany({ where: { isActive: true, user: { isActive: true, role: "SELLER" } }, select: { storeSlug: true, updatedAt: true } }),
    ]);
    return [...pages, ...stores.map((store) => ({ url: `${SITE_URL}/store/${store.storeSlug}`, lastModified: store.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })), ...products.map((product) => ({ url: `${SITE_URL}/products/${product.slug}`, lastModified: product.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 }))];
  } catch { return pages; }
}
