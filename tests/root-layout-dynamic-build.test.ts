import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootLayout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

describe("root layout runtime rendering", () => {
  it("marks the auth()-using root layout as dynamic", () => {
    // auth() reads runtime authentication configuration.  This declaration keeps
    // Next from evaluating this root layout as static page data during a build.
    expect(rootLayout).toContain('import { auth } from "@/auth"');
    expect(rootLayout).toMatch(/export const dynamic = ["']force-dynamic["'];/);
    expect(rootLayout).toMatch(/await auth\(\)/);
  });
});
