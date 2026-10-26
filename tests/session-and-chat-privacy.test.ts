import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(new URL("../src/auth.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const sessionProviderPath = new URL("../src/components/auth-session-provider.tsx", import.meta.url);
const sessionProviderSource = existsSync(sessionProviderPath) ? readFileSync(sessionProviderPath, "utf8") : "";
const conversationsRoute = readFileSync(new URL("../src/app/api/conversations/route.ts", import.meta.url), "utf8");

describe("session and chat privacy", () => {
  it("keeps active JWT sessions rolling while preserving an absolute lifetime", () => {
    expect(authSource).toContain("const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60");
    expect(authSource).toContain("maxAge: SESSION_MAX_AGE_SECONDS");
    expect(layoutSource).toContain("<AuthSessionProvider session={session}>");
    expect(sessionProviderSource).toContain("<SessionProvider");
    expect(sessionProviderSource).toContain("refetchInterval={15 * 60}");
    expect(sessionProviderSource).toContain("refetchOnWindowFocus");
    expect(sessionProviderSource).toContain("refetchWhenOffline={false}");
    expect(sessionProviderSource).toContain("getSession({ broadcast: false })");
    expect(authSource).toContain("initialSessionStartedAt(token)");
    expect(authSource).toContain("applyAbsoluteSessionPolicy(activeToken)");
  });

  it("does not serialize customer email in the conversation list", () => {
    expect(conversationsRoute).toContain("customer: { select: { name: true, role: true } }");
    expect(conversationsRoute).not.toContain("customer: { select: { name: true, email: true, role: true } }");
  });
});
