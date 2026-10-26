import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const reviewInput = z.object({ orderItemId: z.string().min(1), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional().or(z.literal("")) });

export function maskedReviewerName(name: string | null) {
  const value = (name || "Pembeli").trim();
  if (value.length < 3) return "Pembeli";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(4, Math.max(1, value.length - 2)))}`;
}

export async function getReviewSummary(productId: string) {
  const [aggregate, count] = await Promise.all([
    prisma.productReview.aggregate({ where: { productId }, _avg: { rating: true } }),
    prisma.productReview.count({ where: { productId } }),
  ]);
  return { average: aggregate._avg.rating, count };
}
