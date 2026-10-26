import { afterEach, describe, expect, it, vi } from "vitest";
import { attachProductRatingSummaries } from "@/lib/product-ratings";
import { formatProductRating } from "@/lib/product-rating";
import { prisma } from "@/lib/prisma";

describe("homepage product ratings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads persisted review summaries for a catalog page in one aggregate query", async () => {
    const groupBy = vi.spyOn(prisma.productReview, "groupBy").mockResolvedValue([
      { productId: "reviewed", _avg: { rating: 4.75 }, _count: { _all: 12 } },
    ] as never);

    const products = await attachProductRatingSummaries([{ id: "reviewed", price: 10000 }, { id: "new", price: 12000 }]);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["productId"],
      where: { productId: { in: ["reviewed", "new"] } },
      _avg: { rating: true },
      _count: { _all: true },
    }));
    expect(products[0]?.ratingSummary).toEqual({ average: 4.75, count: 12 });
    expect(products[1]?.ratingSummary).toEqual({ average: null, count: 0 });
    expect(products.map((product) => product.id)).toEqual(["reviewed", "new"]);
  });

  it("does not query or invent ratings when the catalog page is empty", async () => {
    const groupBy = vi.spyOn(prisma.productReview, "groupBy");
    await expect(attachProductRatingSummaries([])).resolves.toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("formats average ratings using the Indonesian decimal separator", () => {
    expect(formatProductRating(4.75)).toBe("4,8");
  });
});
