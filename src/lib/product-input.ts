import { z } from "zod";

export function isSafeProductImageReference(value: string) {
  if (value.startsWith("/uploads/products/")) return /^\/uploads\/products\/[a-f0-9-]+\.webp$/.test(value);
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}

const imageReference = z.string().trim().refine(isSafeProductImageReference, "Referensi gambar tidak valid.");

export const productInput = z.object({
  name: z.string().trim().min(2).max(160), shortDescription: z.string().max(500).optional(), description: z.string().trim().min(2).max(10000),
  price: z.coerce.number().int().nonnegative(), compareAtPrice: z.coerce.number().int().nonnegative().optional().or(z.literal("")), categoryId: z.string().min(1),
  thumbnailUrl: imageReference.optional().or(z.literal("")), galleryUrls: z.string().optional(), type: z.enum(["FILE", "LICENSE_KEY", "VOUCHER", "ACCOUNT", "ACCESS_LINK"]), deliveryMode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  isPublished: z.coerce.boolean().default(false), isFeatured: z.coerce.boolean().default(false), stock: z.coerce.number().int().nonnegative().optional().or(z.literal("")), sellerId: z.string().optional(), seoTitle: z.string().max(180).optional(), seoDescription: z.string().max(320).optional(),
});

export function productData(raw: unknown) {
  const parsed = productInput.parse(raw);
  const galleryUrls = (parsed.galleryUrls ?? "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
  if (galleryUrls.length > 6) throw new Error("Gallery maksimal 6 gambar.");
  if (galleryUrls.some((url) => !isSafeProductImageReference(url))) throw new Error("Referensi gallery image tidak valid.");
  const stock = ["LICENSE_KEY", "VOUCHER", "ACCOUNT", "ACCESS_LINK"].includes(parsed.type) ? null : parsed.stock === "" ? null : parsed.stock;
  return { ...parsed, compareAtPrice: parsed.compareAtPrice === "" ? null : parsed.compareAtPrice, stock, thumbnailUrl: parsed.thumbnailUrl || null, galleryUrls, sellerId: parsed.sellerId || null, shortDescription: parsed.shortDescription || null, seoTitle: parsed.seoTitle || parsed.name, seoDescription: parsed.seoDescription || parsed.shortDescription || parsed.description.slice(0, 320) };
}
