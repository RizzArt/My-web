import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { assertNotLastActiveAdmin, hashAdminPassword, isLoginRateLimited, recordLoginFailure } from "@/lib/admin-security";

const authSource = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
const registerSource = readFileSync(new URL("../src/app/api/auth/register/route.ts", import.meta.url), "utf8");
const adminLayout = readFileSync(new URL("../src/app/admin/layout.tsx", import.meta.url), "utf8");
const createScript = readFileSync(new URL("../scripts/create-admin.ts", import.meta.url), "utf8");
const disableScript = readFileSync(new URL("../scripts/disable-demo-admin.ts", import.meta.url), "utf8");

describe("production admin security", () => {
  it("enforces server-side admin-only access and does not allow public role selection", () => {
    expect(adminLayout).toContain("requireAdmin");
    expect(registerSource).not.toContain("role:");
    expect(authSource).toContain("!user.isActive");
  });

  it("hashes a strong admin password with bcrypt and never logs it", async () => {
    const password = "ProductionAdmin42!";
    const hash = await hashAdminPassword(password);
    expect(hash).not.toContain(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(createScript).not.toContain("console.log(password");
    expect(createScript).toContain("emailVerified: new Date()");
  }, 15000);

  it("rate limits failures for a bounded window", () => {
    const key = `test-${Date.now()}`;
    for (let index = 0; index < 10; index += 1) recordLoginFailure(key);
    expect(isLoginRateLimited(key)).toBe(true);
  });

  it("protects the last active admin and audits lifecycle events without secrets", async () => {
    const tx = {
      user: {
        findUnique: async () => ({ role: "ADMIN", isActive: true }),
        count: async () => 1,
      },
    } as never;
    await expect(assertNotLastActiveAdmin(tx, "admin-id")).rejects.toThrow("satu admin aktif");
    expect(createScript).toContain("ADMIN_CREATED");
    expect(disableScript).toContain("ADMIN_DISABLED");
    expect(createScript).not.toContain("passwordHash: password");
    expect(createScript).not.toContain("metadata: { password");
    expect(disableScript).not.toContain("password");
  });
});
