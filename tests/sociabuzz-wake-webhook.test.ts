import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { POST } from "@/app/api/webhooks/sociabuzz/route";
import {
  SOCIABUZZ_WAKE_DEBOUNCE_MS,
  SOCIABUZZ_WAKE_MAX_BODY_BYTES,
} from "@/lib/webhooks/sociabuzz-wake";

let testDirectory: string | undefined;

async function configureMarker() {
  testDirectory = await mkdtemp(join(tmpdir(), "sociabuzz-wake-"));
  vi.stubEnv("SOCIABUZZ_WAKE_MARKER_PATH", join(testDirectory, "wake"));
}

async function markerMtime() {
  return (await stat(join(testDirectory!, "wake"))).mtimeMs;
}

function webhook(body: string, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/webhooks/sociabuzz", {
    method: "POST",
    headers,
    body,
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = undefined;
});

describe("POST /api/webhooks/sociabuzz", () => {
  it("acknowledges an untrusted webhook and writes one fixed wake marker", async () => {
    await configureMarker();
    const response = await POST(webhook('{"id":"untrusted-id","amount":9999,"status":"PAID"}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    await expect(stat(join(testDirectory!, "wake"))).resolves.toBeDefined();
  });

  it("does not parse, retain, or log webhook identifiers, amounts, or statuses", async () => {
    await configureMarker();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const payload = '{"id":"provider-id-must-not-appear","amount":987654,"status":"paid-must-not-appear"}';

    const response = await POST(webhook(payload, { "Content-Type": "application/json" }));
    const routeSource = readFileSync(resolve(process.cwd(), "src/app/api/webhooks/sociabuzz/route.ts"), "utf8");
    const logged = JSON.stringify(log.mock.calls);

    expect(response.status).toBe(200);
    expect(logged).not.toContain("provider-id-must-not-appear");
    expect(logged).not.toContain("987654");
    expect(logged).not.toContain("paid-must-not-appear");
    expect(routeSource).not.toMatch(/request\.(?:json|text|formData)/);
    expect(routeSource).not.toMatch(/prisma|verifySociaBuzzOrder|settle|wallet|earning|delivery/i);
  });

  it("acknowledges malformed JSON without changing wake behavior", async () => {
    await configureMarker();
    const response = await POST(webhook('{not-json'));

    expect(response.status).toBe(200);
    await expect(stat(join(testDirectory!, "wake"))).resolves.toBeDefined();
  });

  it("keeps an oversized body bounded and acknowledges it without exposing content", async () => {
    await configureMarker();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const secret = "oversized-body-must-not-appear";
    const response = await POST(webhook(secret, {
      "Content-Length": String(SOCIABUZZ_WAKE_MAX_BODY_BYTES + 1),
    }));

    expect(response.status).toBe(200);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).toContain("body_too_large");
  });

  it("debounces repeat wake requests using the marker mtime", async () => {
    await configureMarker();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await POST(webhook('{"id":"first"}'));
    const firstMtime = await markerMtime();
    await POST(webhook('{"id":"second"}'));

    expect(await markerMtime()).toBe(firstMtime);
    const secondEvent = JSON.parse(String(log.mock.calls[1]?.[1]));
    expect(secondEvent).toMatchObject({ debounced: true, wake_written: false });
    expect(SOCIABUZZ_WAKE_DEBOUNCE_MS).toBe(60_000);
  });

  it("collapses concurrent requests to one marker update", async () => {
    await configureMarker();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) => POST(webhook(`{"id":"${index}","amount":${index},"status":"paid"}`))),
    );
    const events = log.mock.calls.map((call) => JSON.parse(String(call[1])));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(events.filter((event) => event.wake_written).length).toBe(1);
    expect(events.filter((event) => event.debounced).length).toBeGreaterThan(0);
  });

  it("acknowledges a wake-write failure without a database or direct worker action", async () => {
    const missingParent = await mkdtemp(join(tmpdir(), "sociabuzz-wake-missing-"));
    vi.stubEnv("SOCIABUZZ_WAKE_MARKER_PATH", join(missingParent, "missing", "wake"));
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(webhook('{"id":"ignored"}'));

    expect(response.status).toBe(200);
    expect(JSON.parse(String(log.mock.calls[0]?.[1]))).toMatchObject({
      wake_written: false,
      error_category: "wake_write_failed",
    });
    await rm(missingParent, { recursive: true, force: true });
  });
});
