import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { destinationForRole } from "@/lib/auth-redirect";
import { registrationSchema } from "@/lib/auth-validation";

const loginPage = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const registerPage = readFileSync(new URL("../src/app/register/page.tsx", import.meta.url), "utf8");

describe("production auth experience", () => {
  it("does not expose test credentials in auth pages", () => {
    expect(`${loginPage}\n${registerPage}`).not.toMatch(/password123|digitalstore\.test|demo account|test account|admin@|customer@/i);
  });

  it("uses safe credential copy and password manager attributes", () => {
    expect(loginPage).toContain("Email atau kata sandi tidak valid.");
    expect(loginPage).toContain("autoComplete=\"current-password\"");
    expect(registerPage).toContain("autoComplete=\"new-password\"");
  });

  it("keeps role destinations explicit", () => {
    expect(destinationForRole("CUSTOMER")).toBe("/dashboard");
    expect(destinationForRole("SELLER")).toBe("/seller");
    expect(destinationForRole("ADMIN")).toBe("/admin");
  });

  it("validates registration on the server schema", () => {
    expect(registrationSchema.safeParse({ name: "A", email: "bad", password: "short", passwordConfirmation: "short", acceptedTerms: false }).success).toBe(false);
    expect(registrationSchema.safeParse({ name: "Nama Pengguna", email: "USER@EXAMPLE.COM", password: "secure-pass", passwordConfirmation: "different-pass", acceptedTerms: true }).success).toBe(false);
    expect(registrationSchema.safeParse({ name: "Nama Pengguna", email: "USER@EXAMPLE.COM", password: "secure-pass", passwordConfirmation: "secure-pass", acceptedTerms: true }).success).toBe(true);
  });
});
