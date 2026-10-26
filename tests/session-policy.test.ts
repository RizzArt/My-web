import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ABSOLUTE_SESSION_SECONDS,
  CUSTOMER_ABSOLUTE_SESSION_SECONDS,
  applyAbsoluteSessionPolicy,
  initialSessionStartedAt,
} from "@/lib/session-policy";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("absolute session lifetime", () => {
  const hour = 60 * 60 * 1000;
  const startedAt = Date.UTC(2026, 9, 13, 0, 0, 0);

  it("pins the reviewed Auth.js prerelease exactly", () => {
    expect(packageJson.dependencies["next-auth"]).toBe("5.0.0-beta.32");
  });

  it("preserves an immutable session start across rolling JWT refreshes", () => {
    expect(initialSessionStartedAt({ sessionStartedAt: startedAt, iat: (startedAt + 6 * hour) / 1000 }, startedAt + 6 * hour)).toBe(startedAt);
  });

  it("migrates an existing token from its latest issued-at time without forcing a global logout", () => {
    expect(initialSessionStartedAt({ iat: startedAt / 1000 }, startedAt + hour)).toBe(startedAt);
  });

  it("expires admin sessions at the absolute 24-hour boundary despite polling", () => {
    const token = { role: "ADMIN", sessionStartedAt: startedAt } as const;
    expect(applyAbsoluteSessionPolicy(token, startedAt + ADMIN_ABSOLUTE_SESSION_SECONDS * 1000 - 1)).toBe(token);
    expect(applyAbsoluteSessionPolicy(token, startedAt + ADMIN_ABSOLUTE_SESSION_SECONDS * 1000)).toBeNull();
  });

  it("expires customer sessions at the absolute seven-day boundary despite polling", () => {
    const token = { role: "CUSTOMER", sessionStartedAt: startedAt } as const;
    expect(applyAbsoluteSessionPolicy(token, startedAt + CUSTOMER_ABSOLUTE_SESSION_SECONDS * 1000 - 1)).toBe(token);
    expect(applyAbsoluteSessionPolicy(token, startedAt + CUSTOMER_ABSOLUTE_SESSION_SECONDS * 1000)).toBeNull();
  });

  it("rejects malformed or future session-start claims", () => {
    expect(applyAbsoluteSessionPolicy({ role: "CUSTOMER", sessionStartedAt: Number.NaN }, startedAt)).toBeNull();
    expect(applyAbsoluteSessionPolicy({ role: "CUSTOMER", sessionStartedAt: startedAt + 60_000 }, startedAt)).toBeNull();
  });
});
