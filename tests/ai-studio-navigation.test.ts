import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => {
  const target = path.join(process.cwd(), file);
  return existsSync(target) ? readFileSync(target, "utf8") : "";
};
const header = read("src/components/header.tsx");
const mobile = read("src/components/mobile-menu.tsx");
const studioLink = read("src/components/ai-studio-nav-link.tsx");
const css = read("src/app/globals.css");

describe("AI Studio navigation promotion", () => {
  it("places the styled AI Studio link before regular desktop navigation", () => {
    expect(header).toContain('import { AiStudioNavLink } from "./ai-studio-nav-link"');
    expect(header.indexOf("<AiStudioNavLink")).toBeGreaterThan(-1);
    expect(header.indexOf("<AiStudioNavLink")).toBeLessThan(header.indexOf('href="/products"'));
  });

  it("places the customer-facing AI Studio route first for every mobile role", () => {
    expect(mobile).toContain('const customerLinks = [["AI Studio", "/studio"], ["Beranda", "/"]');
    expect(mobile).toContain('const sellerLinks = [["AI Studio", "/studio"], ["Beranda", "/"]');
    expect(mobile).toContain('const adminLinks = [["AI Studio", "/studio"], ["Dasbor Admin", "/admin"], ["Pengaturan AI Studio", "/admin/studio"]');
    expect(mobile).toContain('href === "/studio"');
    expect(mobile).toContain("<AiStudioNavLink");
  });

  it("keeps the drawer through tablet widths and compacts dense admin links", () => {
    expect(header).toContain('className="hidden items-center gap-5 text-sm font-medium xl:flex"');
    expect(header).not.toContain('className="hidden items-center gap-5 text-sm font-medium md:flex"');
    expect(header).toContain('className="admin-nav-menu"');
    expect(header).toContain('aria-label="Buka menu admin"');
    expect(header).toContain('href="/admin/refunds"');
    expect(header).toContain('href="/admin/cancellations"');
    expect(header).toContain('href="/admin/customer-withdrawals"');
    expect(mobile).not.toContain("md:hidden");
    expect(mobile.match(/xl:hidden/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses accessible neon styling inspired by the supplied reference", () => {
    expect(studioLink).toContain('aria-label="Buka AI Studio"');
    expect(studioLink).toContain("ai-studio-nav__icon");
    expect(studioLink).toContain("ai-studio-nav__ai");
    expect(studioLink).toContain("AI</span> Studio");
    expect(css).toContain(".ai-studio-nav");
    expect(css).toContain(".ai-studio-nav__ai");
    expect(css).toContain("#22d3ee");
    expect(css).toContain("#8b5cf6");
  });
});
