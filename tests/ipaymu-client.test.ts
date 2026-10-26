import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ipaymuConfig,
  ipaymuRequest,
  ipaymuSignature,
} from "../src/lib/payments/ipaymu-client";

function configure() {
  vi.stubEnv("IPAYMU_MODE", "sandbox");
  vi.stubEnv("IPAYMU_VA", "123456");
  vi.stubEnv("IPAYMU_API_KEY", "test-key");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("iPaymu API client", () => {
  it("matches an independently calculated signature vector", () => {
    expect(ipaymuSignature(
      "POST", "123456", "test-key", '{"amount":10000}',
    )).toBe("090bac919abe43da2d0cd793c8b692584d3a9fca82024eb1679c0d4a2cc9b576");
  });

  it("rejects invalid environment modes", () => {
    configure();
    vi.stubEnv("IPAYMU_MODE", "live-typo");
    expect(() => ipaymuConfig()).toThrow("IPAYMU_MODE");
  });

  it("requires credentials", () => {
    configure();
    vi.stubEnv("IPAYMU_API_KEY", "");
    expect(() => ipaymuConfig()).toThrow("belum lengkap");
  });

  it("reads sandbox channels without sending a GET body", async () => {
    configure();
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        Status: 200, Success: true, Data: [],
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", mock);
    expect(await ipaymuRequest("GET", "/api/v2/payment-channels")).toEqual([]);
    const [url, options] = mock.mock.calls[0];
    expect(url).toBe("https://sandbox.ipaymu.com/api/v2/payment-channels");
    expect(options.body).toBeUndefined();
    expect(options.redirect).toBe("error");
    expect(options.headers.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsuccessful gateway responses", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        Status: 400, Success: false, Data: null,
      }), { status: 200 }),
    ));
    await expect(
      ipaymuRequest("GET", "/api/v2/payment-channels"),
    ).rejects.toThrow("belum berhasil");
  });

  it("does not expose credentials from network errors", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error("internal error containing test-key"),
    ));
    await expect(
      ipaymuRequest("GET", "/api/v2/payment-channels"),
    ).rejects.toThrow("hasil permintaan belum dapat dipastikan");
  });
});
