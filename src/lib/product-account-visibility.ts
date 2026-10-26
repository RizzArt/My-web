import type { Prisma } from "@prisma/client";

export function activeSellerProductWhere(): Prisma.ProductWhereInput {
  return {
    AND: [{
      OR: [
        { sellerId: null },
        { seller: { is: {
          isActive: true,
          user: { is: { isActive: true, role: "SELLER" } },
        } } },
      ],
    }],
  };
}
