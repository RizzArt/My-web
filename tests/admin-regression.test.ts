import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sumFinanceEarnings, sumWithdrawals } from "@/lib/seller-finance";

const dashboard = readFileSync(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("../src/app/admin/customers/page.tsx", import.meta.url), "utf8");
const auditLogs = readFileSync(new URL("../src/app/admin/audit-logs/page.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/app/store/[slug]/page.tsx", import.meta.url), "utf8");

describe("admin and storefront regressions", () => {
  it("keeps empty finance aggregates safe for the dashboard", () => {
    expect(sumFinanceEarnings([])).toEqual({ grossAmount: 0, platformFee: 0, netAmount: 0 });
    expect(sumWithdrawals([])).toEqual({ pending: 0, paid: 0 });
    expect(dashboard).toContain("financeAggregate(undefined, range.selected)");
  });

  it("does not select password hashes for the admin order dashboard", () => {
    expect(dashboard).toContain('user: { select: { name: true, email: true } }');
    expect(dashboard).not.toContain("include: { user: true");
  });

  it("keeps customer listing admin-only and limited to safe fields", () => {
    expect(customers).toContain("requireAdmin");
    expect(customers).toContain("name: true, email: true, createdAt: true");
    expect(customers).not.toContain("passwordHash");
  });

  it("renders historical audit rows with nullable actors and raw actions", () => {
    expect(auditLogs).toContain("log.actor?.name ?? log.actor?.email ?? \"System\"");
    expect(auditLogs).toContain("{log.action}");
    expect(auditLogs).not.toContain("metadata.");
  });

  it("uses Prisma-compatible rating aggregation for storefront sorting", () => {
    expect(store).toContain('productReview.groupBy({ by: ["productId"]');
    expect(store).not.toContain('orderBy: query.sort === "rating"');
    expect(store).not.toContain("reviews: { _avg: { rating");
  });
});
