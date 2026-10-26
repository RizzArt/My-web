import { describe, expect, it } from "vitest";
import { inventoryCounts, maskInventoryValue, parseInventoryValues } from "@/lib/inventory";

describe("digital inventory rules", () => {
  it("parses bulk values, ignores blanks, and reports duplicates", () => {
    const result = parseInventoryValues(" KEY-1 \n\nkey-1\nKEY-2 ", "LICENSE_KEY");
    expect(result.values).toEqual(["KEY-1", "KEY-2"]);
    expect(result.duplicate).toBe(1);
  });
  it("rejects invalid access links without exposing secrets", () => {
    expect(parseInventoryValues("not-a-link\nhttps://example.com/private", "ACCESS_LINK").values).toEqual(["https://example.com/private"]);
    expect(maskInventoryValue("XXXX-AAAA-1111")).toContain("1111");
    expect(maskInventoryValue("XXXX-AAAA-1111")).not.toContain("AAAA");
  });
  it("counts available, reserved, and delivered separately", () => {
    expect(inventoryCounts([{ status: "AVAILABLE" }, { status: "ASSIGNED" }, { status: "DELIVERED" }, { status: "SOLD" }])).toEqual({ available: 1, reserved: 1, sold: 2, total: 4 });
  });
});
