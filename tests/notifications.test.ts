import { describe, expect, it } from "vitest";
import { broadcastInput, targetRoleWhere } from "@/lib/notifications";

describe("notification broadcast rules", () => {
  it("targets only customers, sellers, or both non-admin roles", () => {
    expect(targetRoleWhere("CUSTOMER")).toEqual({ role: "CUSTOMER" });
    expect(targetRoleWhere("SELLER")).toEqual({ role: "SELLER" });
    expect(targetRoleWhere("ALL")).toEqual({ role: { in: ["CUSTOMER", "SELLER"] } });
  });

  it("accepts sanitized internal links and rejects external links", () => {
    expect(broadcastInput.safeParse({ title: "Sale", message: "Now", targetAudience: "CUSTOMER", link: "/products" }).success).toBe(true);
    expect(broadcastInput.safeParse({ title: "Sale", message: "Now", targetAudience: "CUSTOMER", link: "https://example.com" }).success).toBe(false);
  });
});
