import { describe, expect, it } from "vitest";
import { cleanMessage } from "@/lib/chat";
import { maskedReviewerName, reviewInput } from "@/lib/reviews";

describe("product detail review and chat input rules", () => {
  it("accepts only ratings from one to five", () => {
    expect(reviewInput.safeParse({ orderItemId: "item-1", rating: 5 }).success).toBe(true);
    expect(reviewInput.safeParse({ orderItemId: "item-1", rating: 6 }).success).toBe(false);
  });
  it("rejects blank and oversized chat messages", () => {
    expect(() => cleanMessage("   ")).toThrow();
    expect(() => cleanMessage("x".repeat(2001))).toThrow();
  });
  it("keeps chat content trimmed as plain text", () => {
    expect(cleanMessage("  <b>halo</b>  ")).toBe("<b>halo</b>");
  });
  it("masks reviewer names", () => {
    expect(maskedReviewerName("Budi Santoso")).toBe("Bu****");
  });
});
