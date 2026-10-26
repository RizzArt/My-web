import { describe, expect, it, vi, afterEach } from "vitest";
import { SekaiImageProvider, SekaiProviderError, SEKAI_IMAGES_URL } from "@/lib/studio/providers/sekai";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const truncatedPngBase64 = Buffer.from(pngBase64, "base64").subarray(0, -12).toString("base64");
const badCrcPngBase64 = (() => { const data = Buffer.from(pngBase64, "base64"); data[data.length - 1] ^= 1; return data.toString("base64"); })();
const request = { model: "pixel/gpt-image-2", prompt: "neutral landscape", aspectRatio: "1:1", outputCount: 1 };
const response = (status: number, body: unknown = { data: [{ b64_json: pngBase64 }] }, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const cancellableResponse = (status: number) => {
  const cancel = vi.fn();
  return { cancel, value: new Response(new ReadableStream<Uint8Array>({ cancel }), { status }) };
};

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("SEKAI Pixel provider", () => {
  it("uses the fixed endpoint, private bearer credential, and exact Pixel body", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret"); const fetcher = vi.fn(() => Promise.resolve(response(200)));
    await new SekaiImageProvider({ fetch: fetcher, uuid: () => "11111111-1111-4111-8111-111111111111" }).generate(request);
    expect(fetcher).toHaveBeenCalledWith(SEKAI_IMAGES_URL, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-secret", "Idempotency-Key": "11111111-1111-4111-8111-111111111111" }), body: JSON.stringify({ model: request.model, prompt: request.prompt, n: 1, size: "1024x1024", quality: "low", response_format: "b64_json" }) }));
  });
  it("accepts all official model IDs and rejects arbitrary models or unsupported controls", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret"); const fetcher = vi.fn(() => Promise.resolve(response(200)));
    for (const model of ["pixel/gpt-image-2", "pixel/gemini-3.1-flash-image", "pixel/gemini-2.5-flash-image"]) await new SekaiImageProvider({ fetch: fetcher }).generate({ ...request, model });
    const provider = new SekaiImageProvider({ fetch: fetcher });
    await expect(provider.generate({ ...request, model: "anything" })).rejects.toThrow("Model SEKAI");
    await expect(provider.generate({ ...request, referenceImage: Buffer.from("x") })).rejects.toThrow("reference image");
    await expect(provider.generate({ ...request, aspectRatio: "16:9" })).rejects.toThrow("Aspect ratio");
    await expect(provider.generate({ ...request, outputCount: 2 })).rejects.toThrow("Jumlah output");
  });
  it("decodes a valid image and rejects empty, malformed, and non-image base64", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    await expect(new SekaiImageProvider({ fetch: vi.fn().mockResolvedValue(response(200)) }).generate(request)).resolves.toMatchObject({ images: [{ mimeType: "image/png" }] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const b64_json of ["", "not base64!", Buffer.from("not an image").toString("base64"), badCrcPngBase64]) await expect(new SekaiImageProvider({ fetch: vi.fn().mockImplementation(async () => response(200, { data: [{ b64_json }] })), wait: async () => undefined }).generate(request)).rejects.toThrow("gambar valid");
  });
  it("does not retry permanent HTTP failures or leak the key/base64", async () => {
    vi.stubEnv("SEKAI_API_KEY", "very-private-key");
    const expected = new Map([[400, ["INVALID_REQUEST", "Permintaan ke SEKAI tidak valid."]], [401, ["AUTH", "Konfigurasi/autentikasi SEKAI tidak valid."]], [402, ["CREDIT", "Saldo/credit provider tidak mencukupi."]], [403, ["AUTH", "Konfigurasi/autentikasi SEKAI tidak valid."]]]);
    for (const [status, [category, safeMessage]] of expected) {
      const fetcher = vi.fn().mockResolvedValue(response(status, { error: { message: "very-private-key" } }));
      const error = await new SekaiImageProvider({ fetch: fetcher }).generate(request).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(SekaiProviderError);
      expect(error).toMatchObject({ status, category, safeMessage, retryable: false, attempt: 1 });
      expect(JSON.stringify(error)).not.toContain("very-private-key");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("cancels unused response bodies for permanent and retried HTTP failures", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    const permanent = cancellableResponse(400);
    await new SekaiImageProvider({ fetch: vi.fn().mockResolvedValue(permanent.value) }).generate(request).catch(() => undefined);
    expect(permanent.cancel).toHaveBeenCalledTimes(1);

    const retryable = [cancellableResponse(500), cancellableResponse(502), cancellableResponse(503)];
    const fetcher = vi.fn()
      .mockResolvedValueOnce(retryable[0].value)
      .mockResolvedValueOnce(retryable[1].value)
      .mockResolvedValueOnce(retryable[2].value);
    await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined }).generate(request).catch(() => undefined);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const item of retryable) expect(item.cancel).toHaveBeenCalledTimes(1);
  });
  it("retries timeout, limit, server, and network failures using the same idempotency key", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    for (const first of [response(408), response(429), response(500)]) { const fetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(response(200)); const waits: number[] = []; await new SekaiImageProvider({ fetch: fetcher, wait: async (ms) => { waits.push(ms); }, random: () => 0, uuid: () => "same-key" }).generate(request); expect(fetcher).toHaveBeenCalledTimes(2); expect(waits).toHaveLength(1); expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetcher.mock.calls[1][1].headers["Idempotency-Key"]); }
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("network unavailable")).mockResolvedValueOnce(response(200)); await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined, uuid: () => "same-key" }).generate(request); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries a header-parseable but truncated HTTP 200 image with the same idempotency key", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { data: [{ b64_json: truncatedPngBase64 }] }, { "x-request-id": "invalid-request" }))
      .mockResolvedValueOnce(response(200));
    const waits: number[] = [];
    await expect(new SekaiImageProvider({ fetch: fetcher, wait: async (ms) => { waits.push(ms); }, random: () => 0, uuid: () => "same-key" }).generate(request)).resolves.toMatchObject({ images: [{ mimeType: "image/png" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([750]);
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).toEqual(["same-key", "same-key"]);
  });
  it("fails after three header-parseable but truncated images", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockImplementation(async () => response(200, { data: [{ b64_json: truncatedPngBase64 }] }));
    const error = await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined, uuid: () => "same-key" }).generate(request).catch((value: unknown) => value);
    expect(error).toMatchObject({ category: "INVALID_RESPONSE", retryable: true, attempt: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).toEqual(["same-key", "same-key", "same-key"]);
  });
  it("logs only sanitized response structure and fails after three invalid responses", async () => {
    vi.stubEnv("SEKAI_API_KEY", "provider-key-must-not-leak");
    const logged: unknown[][] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args); });
    let uuidCalls = 0;
    const fetcher = vi.fn().mockImplementation(async () => response(200, { data: [{ b64_json: "raw-provider-body-must-not-leak" }], secretField: "secret-value" }, { "x-request-id": "safe-request-id", "content-length": "123" }));
    const error = await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined, uuid: () => `key-${++uuidCalls}` }).generate({ ...request, prompt: "prompt-must-not-leak" }).catch((value: unknown) => value);
    consoleError.mockRestore();
    expect(error).toMatchObject({ category: "INVALID_RESPONSE", safeMessage: "SEKAI tidak mengembalikan gambar valid.", status: 200, providerRequestId: "safe-request-id", retryable: true, attempt: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(uuidCalls).toBe(1);
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).toEqual(["key-1", "key-1", "key-1"]);
    expect(logged).toHaveLength(3);
    const serialized = JSON.stringify(logged);
    expect(serialized).toContain("artifactLengthBucket");
    expect(serialized).toContain("safe-request-id");
    expect(serialized).not.toMatch(/provider-key-must-not-leak|raw-provider-body-must-not-leak|secret-value|secretField|prompt-must-not-leak/);
  });
  it("bounds provider-controlled content type diagnostics", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    const logged: unknown[][] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args); });
    const marker = "provider-controlled-marker";
    const contentType = `application/${marker.repeat(1_000)}`;
    const fetcher = vi.fn().mockImplementation(async () => response(200, { data: [] }, { "content-type": contentType }));
    await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined }).generate(request).catch(() => undefined);
    consoleError.mockRestore();
    expect(JSON.stringify(logged)).not.toContain(marker);
    expect(logged[0]?.[1]).toMatchObject({ contentType: "other" });
  });
  it("rejects an oversized declared response without reading or retrying it", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockImplementation(async () => response(200, { data: [{ b64_json: pngBase64 }] }, { "content-length": "99999999" }));
    const error = await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined }).generate(request).catch((value: unknown) => value);
    expect(error).toMatchObject({ category: "INVALID_RESPONSE", retryable: false, attempt: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honors bounded Retry-After and creates a fresh idempotency key per generation", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret"); const waits: number[] = []; const fetcher = vi.fn().mockResolvedValueOnce(response(429, {}, { "retry-after": "120" })).mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(200)); let sequence = 0;
    const provider = new SekaiImageProvider({ fetch: fetcher, wait: async (ms) => { waits.push(ms); }, uuid: () => `key-${++sequence}` }); await provider.generate(request); await provider.generate(request);
    expect(waits[0]).toBe(12_000); expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetcher.mock.calls[1][1].headers["Idempotency-Key"]); expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).not.toBe(fetcher.mock.calls[2][1].headers["Idempotency-Key"]);
  });
  it("keeps the final retryable status and request ID after exactly three attempts", async () => {
    vi.stubEnv("SEKAI_API_KEY", "very-private-key");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(500, { error: "ignore" }, { "x-request-id": "first-request" }))
      .mockResolvedValueOnce(response(503, { error: "ignore" }, { "x-request-id": "second-request" }))
      .mockResolvedValueOnce(response(502, { error: "ignore" }, { "x-request-id": "third-request" }));
    const error = await new SekaiImageProvider({ fetch: fetcher, wait: async () => undefined, uuid: () => "same-key" }).generate({ ...request, prompt: "prompt-that-must-not-leak" }).catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 502, category: "UPSTREAM", safeMessage: "Layanan generation SEKAI sedang bermasalah.", providerRequestId: "third-request", retryable: true, attempt: 3 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).toEqual(["same-key", "same-key", "same-key"]);
    expect(JSON.stringify(error)).not.toMatch(/very-private-key|prompt-that-must-not-leak|error/);
  });
  it("classifies timeout, rate-limit, invalid image, and network failures without raw provider data", async () => {
    vi.stubEnv("SEKAI_API_KEY", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scenarios: Array<[string, () => Promise<unknown>, Partial<SekaiProviderError>]> = [
      ["timeout", () => new SekaiImageProvider({ fetch: vi.fn().mockRejectedValue(Object.assign(new Error("internal"), { name: "TimeoutError" })), wait: async () => undefined }).generate(request), { category: "TIMEOUT", safeMessage: "SEKAI melewati batas waktu.", attempt: 3 }],
      ["rate limit", () => new SekaiImageProvider({ fetch: vi.fn().mockResolvedValue(response(429, { detail: "internal" })), wait: async () => undefined }).generate(request), { category: "RATE_LIMIT", safeMessage: "SEKAI sedang membatasi request.", status: 429, attempt: 3 }],
      ["network", () => new SekaiImageProvider({ fetch: vi.fn().mockRejectedValue(new TypeError("network secret")), wait: async () => undefined }).generate(request), { category: "NETWORK", safeMessage: "Tidak dapat terhubung ke layanan generation SEKAI.", attempt: 3 }],
      ["invalid image", () => new SekaiImageProvider({ fetch: vi.fn().mockImplementation(async () => response(200, { data: [{ b64_json: "not-base64" }] }, { "x-request-id": "provider-request-1" })), wait: async () => undefined }).generate(request), { category: "INVALID_RESPONSE", safeMessage: "SEKAI tidak mengembalikan gambar valid.", status: 200, providerRequestId: "provider-request-1", retryable: true, attempt: 3 }],
    ];
    for (const [, generate, expected] of scenarios) {
      const error = await generate().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(SekaiProviderError);
      expect(error).toMatchObject(expected);
      expect(JSON.stringify(error)).not.toMatch(/test-secret|internal|network secret|not-base64/);
    }
  });
});
