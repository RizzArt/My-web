export type ProductRatingSummary = {
  average: number | null;
  count: number;
};

export const emptyProductRating: ProductRatingSummary = { average: null, count: 0 };

export function formatProductRating(average: number) {
  return average.toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
