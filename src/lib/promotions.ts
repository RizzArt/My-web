import { DeliveryMode, Prisma, ProductType, PromotionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { attachStock } from "@/lib/product-stock";

export const PROMOTION_PACKAGES = {
  7: 5000,
  14: 10000,
  30: 15000,
} as const;

export type PromotionDuration = keyof typeof PROMOTION_PACKAGES;
export type PromotionSlide = {
  id: string;
  title: string;
  subtitle: string;
  storeName?: string;
  ctaLabel: string;
  ctaHref: string;
  badge?: string;
  bannerUrl?: string | null;
  active: boolean;
};

const PLATFORM_PROMOTIONS: PromotionSlide[] = [
  { id: "digital-promo", title: "Promo Produk Digital", subtitle: "Temukan produk pilihan dengan harga spesial.", ctaLabel: "Lihat Promo", ctaHref: "/products", badge: "Pilihan minggu ini", active: true },
  { id: "seller-picks", title: "Seller Pilihan Minggu Ini", subtitle: "Jelajahi produk terbaru dari seller aktif.", ctaLabel: "Lihat Seller", ctaHref: "/products", badge: "Seller aktif", active: true },
  { id: "new-daily", title: "Produk Baru Setiap Hari", subtitle: "Template, toolkit, akun digital, dan produk lainnya.", ctaLabel: "Belanja Sekarang", ctaHref: "/products", badge: "Selalu fresh", active: true },
];

export function getPlatformPromotions(): PromotionSlide[] {
  return [...PLATFORM_PROMOTIONS];
}

function isPromotionSlide(value: unknown): value is PromotionSlide {
  if (typeof value !== "object" || value === null) return false;
  const slide = value as Partial<PromotionSlide>;
  return typeof slide.id === "string" && typeof slide.title === "string" && typeof slide.subtitle === "string" &&
    typeof slide.ctaLabel === "string" && typeof slide.ctaHref === "string" && typeof slide.active === "boolean";
}

export function normalizePromotionSlides(value: unknown): PromotionSlide[] {
  return Array.isArray(value) ? value.filter(isPromotionSlide) : [];
}

export function mergePromotionSlides(platformPromos: unknown, sellerPromos: unknown): PromotionSlide[] {
  return [...normalizePromotionSlides(platformPromos), ...normalizePromotionSlides(sellerPromos)];
}

export function getHomepagePromotionSlides(activePromotionSlides: unknown): PromotionSlide[] {
  const activeSlides = normalizePromotionSlides(activePromotionSlides);
  return activeSlides.length > 0 ? activeSlides : getPlatformPromotions();
}

type ActivePromotionRow = {
  id: string;
  title: string;
  subtitle: string | null;
  ctaText: string | null;
  bannerUrl: string | null;
  seller: { storeName: string; storeSlug: string };
  product: { id: string; name: string; slug: string; thumbnailUrl: string | null; type: ProductType; stock: number | null; deliveryMode: DeliveryMode };
};

export const promotionDurations = Object.keys(PROMOTION_PACKAGES).map(Number) as PromotionDuration[];

export function promotionPrice(duration: number) {
  return PROMOTION_PACKAGES[duration as PromotionDuration] ?? null;
}

export function isPromotionCurrentlyActive(promotion: { status: PromotionStatus; startsAt: Date | null; endsAt: Date | null }, now = new Date()) {
  return promotion.status === "ACTIVE" && Boolean(promotion.startsAt && promotion.endsAt && promotion.startsAt <= now && promotion.endsAt > now);
}

export function activePromotionWhere(now: Date): Prisma.PromotionWhereInput {
  return {
    status: "ACTIVE",
    approvedAt: { not: null },
    startsAt: { lte: now },
    endsAt: { gt: now },
    seller: { isActive: true, user: { isActive: true, role: "SELLER" } },
    product: { isPublished: true, moderationStatus: "APPROVED" },
  };
}

const promotionDateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function formatPromotionDate(date: Date | null | undefined) {
  return date ? `${promotionDateFormatter.format(date)} WIB` : "-";
}

export function promotionSlidesFromRows(rows: ActivePromotionRow[], availableProductIds: ReadonlySet<string>): PromotionSlide[] {
  return rows.filter((row) => availableProductIds.has(row.product.id)).map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || `${row.product.name} · ${row.seller.storeName}`,
    storeName: row.seller.storeName,
    ctaLabel: row.ctaText || "Lihat Produk",
    ctaHref: `/store/${row.seller.storeSlug}`,
    badge: "Promosi",
    bannerUrl: row.bannerUrl || row.product.thumbnailUrl,
    active: true,
  }));
}

export async function getActivePromotions(now = new Date()): Promise<PromotionSlide[]> {
  const rows = await prisma.promotion.findMany({
    where: activePromotionWhere(now),
    include: {
      seller: { select: { storeName: true, storeSlug: true } },
      product: { select: { id: true, name: true, slug: true, thumbnailUrl: true, type: true, stock: true, deliveryMode: true } },
    },
    orderBy: { approvedAt: "desc" },
    take: 8,
  });
  const promotionRows = Array.isArray(rows) ? rows : [];
  const products = await attachStock(promotionRows.map((row) => row.product));
  const availableProductIds = new Set(products.filter((product) => product.stockInfo.available).map((product) => product.id));
  return promotionSlidesFromRows(promotionRows, availableProductIds);
}

export async function completeExpiredPromotions(tx: Prisma.TransactionClient, sellerId?: string) {
  await tx.promotion.updateMany({
    where: { status: "ACTIVE", endsAt: { lte: new Date() }, ...(sellerId ? { sellerId } : {}) },
    data: { status: "COMPLETED" },
  });
}
