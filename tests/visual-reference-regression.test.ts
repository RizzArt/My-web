import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = new URL("..", import.meta.url).pathname;
const source = (path: string) => readFileSync(join(projectRoot, path), "utf8");

describe("visual reference: ai-studio-product-gallery-v3-corrective", () => {
  it("restores the approved v3 storefront composition without restoring the rejected redesign", () => {
    expect(source("tailwind.config.ts")).toContain('coral: "#ff6b4a"');
    expect(source("tailwind.config.ts")).toContain('sand: "#f8f3eb"');
    expect(source("src/app/globals.css")).toContain(".grain { background-image: radial-gradient(rgba(23,32,38,.12)");
    expect(source("src/components/header.tsx")).toContain("bg-sand/90");
    expect(source("src/components/header.tsx")).not.toContain("<form");

    const home = source("src/app/page.tsx");
    expect(home).toContain("const latestProducts = products.slice(0, 4)");
    expect(home).toContain("const moreProducts = products.slice(4)");
    expect(home).toContain('className="mt-4 flex max-w-3xl gap-2 rounded-2xl bg-white p-2 shadow-soft');
    expect(home).toContain("overflow-x-auto pb-1");
    expect(home).toContain("lg:grid-cols-4");
    expect(home).not.toContain("lg:grid-cols-5");

    expect(source("src/app/products/page.tsx")).toContain("mt-10 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4");
    expect(source("src/components/product-card.tsx")).toContain("aspect-[1.12/1]");
    expect(source("src/components/product-gallery.tsx")).toContain("rounded-[1.75rem]");
    expect(source("src/components/promo-slider.tsx")).toContain("text-mint");
    expect(source("src/components/promo-slider.tsx")).toContain("h-1.5 w-6 bg-coral");
  });

  it("keeps security, payment, read receipt, and seller-delivery source gates from the current release", () => {
    const login = source("src/app/login/page.tsx");
    expect(login).toContain('mfaCode: form.get("mfaCode")');
    expect(login).toContain('name="mfaCode"');
    expect(source("src/components/admin-mfa-panel.tsx")).toContain("adminMfaEnrollmentPayload(form)");
    expect(source("src/lib/admin-mfa-enrollment-input.ts")).toContain("...(typeof mfaCode === \"string\" ? { mfaCode } : {})");
    expect(source("src/app/reset-password/page.tsx")).toContain("window.history.replaceState(null, \"\", window.location.pathname)");
    expect(source("src/app/reset-password/layout.tsx")).toContain("history.replaceState");
    expect(source("src/lib/security-rate-limit.ts")).toContain("RATE_LIMIT_SECRET");
    expect(source("src/lib/trusted-client-ip.ts")).toContain("x-riezz-trusted-client-ip");
    expect(source("src/lib/payments/paypal-eligibility.ts")).toContain("hasOnlyPayPalEligibleSeller");
    expect(source("src/components/conversation-page.tsx")).toContain('message.readAt ? "✓✓" : "✓"');
    expect(source("src/lib/delivery/service.ts")).toContain("WAITING_MANUAL_DELIVERY");
  });
});
