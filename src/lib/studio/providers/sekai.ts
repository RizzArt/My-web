import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MAX_STUDIO_OUTPUT_BYTES } from "../storage";
import { assertStudioProviderRequest, type StudioImageProvider, type StudioProviderErrorCategory, type StudioProviderFailure, type StudioProviderRequest, type StudioProviderResult } from "./types";

const SEKAI_IMAGES_URL = "https://api.sekaigateway.xyz/v1/images/generations";
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 12_000;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_DECODE_PIXELS = 16_000_000;

type FetchLike = typeof fetch;
type Wait = (milliseconds: number) => Promise<void>;
type ProviderOptions = { fetch?: FetchLike; wait?: Wait; random?: () => number; uuid?: () => string };
type SekaiFailureDetails = StudioProviderFailure;

export class SekaiProviderError extends Error implements StudioProviderFailure {
  readonly safeMessage: string;
  readonly status?: number;
  readonly providerRequestId?: string;
  readonly retryable: boolean;
  readonly category: StudioProviderErrorCategory;
  readonly attempt: number;

  constructor(details: SekaiFailureDetails) {
    super(details.safeMessage);
    this.name = "SekaiProviderError";
    this.safeMessage = details.safeMessage;
    this.status = details.status;
    this.providerRequestId = details.providerRequestId;
    this.retryable = details.retryable;
    this.category = details.category;
    this.attempt = details.attempt;
  }
}

function wait(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }
function retryAfterMilliseconds(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1_000), MAX_RETRY_DELAY_MS);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS);
  return undefined;
}
function retryDelay(attempt: number, retryAfter: string | null, random: () => number) {
  return retryAfterMilliseconds(retryAfter) ?? Math.min(MAX_RETRY_DELAY_MS, (750 * 2 ** attempt) + Math.floor(random() * 250));
}
function isImageMagic(data: Buffer) {
  if (data.length < 12) return undefined;
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png" as const;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg" as const;
  if (data.subarray(0, 4).equals(Buffer.from("RIFF")) && data.subarray(8, 12).equals(Buffer.from("WEBP"))) return "image/webp" as const;
  return undefined;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();
function crc32(data: Buffer) {
  let value = 0xffffffff;
  for (const byte of data) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function isCompletePng(data: Buffer) {
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  while (offset < data.length) {
    if (data.length - offset < 12) return false;
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length || end < offset) return false;
    const typeStart = offset + 4;
    const typeEnd = typeStart + 4;
    const type = data.toString("ascii", typeStart, typeEnd);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (data.readUInt32BE(typeEnd + length) !== crc32(data.subarray(typeStart, typeEnd + length))) return false;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return false;
      sawHeader = true;
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") return length === 0 && sawHeader && sawImageData && end === data.length;
    offset = end;
  }
  return false;
}
function isCompleteWebp(data: Buffer) {
  if (data.length < 20 || data.readUInt32LE(4) + 8 !== data.length) return false;
  let offset = 12;
  let sawImageChunk = false;
  while (offset < data.length) {
    if (data.length - offset < 8) return false;
    const type = data.toString("ascii", offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > data.length || end < offset) return false;
    if (type === "VP8 " || type === "VP8L" || type === "VP8X") sawImageChunk = true;
    offset = end;
  }
  return sawImageChunk && offset === data.length;
}
function hasCompleteImageStructure(data: Buffer, mimeType: "image/png" | "image/jpeg" | "image/webp") {
  if (mimeType === "image/png") return isCompletePng(data);
  if (mimeType === "image/jpeg") return data.length >= 4 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
  return isCompleteWebp(data);
}

async function decodeImage(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(MAX_STUDIO_OUTPUT_BYTES * 4 / 3) + 8) throw new Error("SEKAI tidak mengembalikan gambar valid.");
  // Strictly check base64 before decoding: Buffer.from otherwise silently accepts junk.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("SEKAI tidak mengembalikan gambar valid.");
  const data = Buffer.from(value, "base64");
  const mimeType = isImageMagic(data);
  if (!mimeType || data.length === 0 || data.length > MAX_STUDIO_OUTPUT_BYTES || !hasCompleteImageStructure(data, mimeType)) throw new Error("SEKAI tidak mengembalikan gambar valid.");
  try {
    const image = sharp(data, { limitInputPixels: MAX_DECODE_PIXELS, sequentialRead: true, failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (mimeType === "image/png" && metadata.format !== "png") || (mimeType === "image/jpeg" && metadata.format !== "jpeg") || (mimeType === "image/webp" && metadata.format !== "webp")) throw new Error("invalid");
    await image.clone().raw().toBuffer();
  } catch { throw new Error("SEKAI tidak mengembalikan gambar valid."); }
  return { data, mimeType };
}

function providerRequestId(headers: Headers) {
  const value = headers.get("x-request-id") ?? headers.get("request-id");
  return value && /^[A-Za-z0-9._:/-]{1,200}$/.test(value) ? value : undefined;
}
function artifactLengthBucket(value: unknown) {
  if (typeof value !== "string") return "not-string";
  if (value.length === 0) return "empty";
  if (value.length <= 1_024) return "1-1024";
  if (value.length <= 1024 * 1024) return "1KB-1MB";
  if (value.length <= 10 * 1024 * 1024) return "1-10MB";
  return ">10MB";
}
function safeContentLength(headers: Headers) {
  const value = headers.get("content-length");
  return value && /^\d{1,12}$/.test(value) ? Number(value) : undefined;
}
function safeContentType(headers: Headers) {
  const value = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "application/json") return value;
  if (value.length <= 100 && /^application\/[a-z0-9.+-]+\+json$/.test(value)) return "application/*+json";
  return "other";
}
function byteLengthBucket(value: number) {
  if (value === 0) return "empty";
  if (value <= 1_024) return "1-1024";
  if (value <= 1024 * 1024) return "1KB-1MB";
  if (value <= MAX_RESPONSE_BYTES) return "1-12MB";
  return ">12MB";
}
async function cancelResponseBody(response: Response) {
  try { await response.body?.cancel(); } catch { /* ignore cancellation failures */ }
}
async function readJsonWithLimit(response: Response) {
  const declaredLength = safeContentLength(response.headers);
  if (declaredLength !== undefined && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch { /* ignore cancellation failures */ }
    return { payload: null as unknown, jsonParsed: false, bodyTooLarge: true, bodyBytes: declaredLength };
  }
  if (!response.body) return { payload: null as unknown, jsonParsed: false, bodyTooLarge: false, bodyBytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bodyBytes += value.byteLength;
      if (bodyBytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore cancellation failures */ }
        return { payload: null as unknown, jsonParsed: false, bodyTooLarge: true, bodyBytes };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(bodyBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { payload: JSON.parse(text) as unknown, jsonParsed: true, bodyTooLarge: false, bodyBytes };
  } catch {
    try { await reader.cancel(); } catch { /* ignore cancellation failures */ }
    return { payload: null as unknown, jsonParsed: false, bodyTooLarge: false, bodyBytes };
  }
}
function safeResponseShape(response: Response, payload: unknown, jsonParsed: boolean, bodyTooLarge: boolean, bodyBytes: number) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined;
  const allowedKeys = new Set(["created", "data", "error", "id"]);
  const keys = record ? Object.keys(record) : [];
  const data = record?.data;
  const first = Array.isArray(data) && data[0] && typeof data[0] === "object" && !Array.isArray(data[0]) ? data[0] as Record<string, unknown> : undefined;
  const artifact = first?.b64_json;
  return {
    contentType: safeContentType(response.headers),
    contentLength: safeContentLength(response.headers),
    bodyLengthBucket: byteLengthBucket(bodyBytes),
    bodyTooLarge,
    jsonParsed,
    payloadType: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload,
    topLevelKeys: keys.filter((key) => allowedKeys.has(key)).sort(),
    otherTopLevelKeyCount: keys.filter((key) => !allowedKeys.has(key)).length,
    dataIsArray: Array.isArray(data),
    dataCount: Array.isArray(data) ? Math.min(data.length, 10) : undefined,
    artifactPresent: first ? Object.hasOwn(first, "b64_json") : false,
    artifactType: typeof artifact,
    artifactLengthBucket: artifactLengthBucket(artifact),
  };
}
function failureForStatus(status: number, requestId: string | undefined, attempt: number): SekaiProviderError {
  if (status === 401 || status === 403) return new SekaiProviderError({ safeMessage: "Konfigurasi/autentikasi SEKAI tidak valid.", status, providerRequestId: requestId, retryable: false, category: "AUTH", attempt });
  if (status === 402) return new SekaiProviderError({ safeMessage: "Saldo/credit provider tidak mencukupi.", status, providerRequestId: requestId, retryable: false, category: "CREDIT", attempt });
  if (status === 408) return new SekaiProviderError({ safeMessage: "SEKAI melewati batas waktu.", status, providerRequestId: requestId, retryable: true, category: "TIMEOUT", attempt });
  if (status === 429) return new SekaiProviderError({ safeMessage: "SEKAI sedang membatasi request.", status, providerRequestId: requestId, retryable: true, category: "RATE_LIMIT", attempt });
  if (status >= 500) return new SekaiProviderError({ safeMessage: "Layanan generation SEKAI sedang bermasalah.", status, providerRequestId: requestId, retryable: true, category: "UPSTREAM", attempt });
  return new SekaiProviderError({ safeMessage: "Permintaan ke SEKAI tidak valid.", status, providerRequestId: requestId, retryable: false, category: "INVALID_REQUEST", attempt });
}
function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class SekaiImageProvider implements StudioImageProvider {
  private readonly fetcher: FetchLike;
  private readonly sleeper: Wait;
  private readonly random: () => number;
  private readonly uuid: () => string;

  constructor(options: ProviderOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.sleeper = options.wait ?? wait;
    this.random = options.random ?? Math.random;
    this.uuid = options.uuid ?? randomUUID;
  }

  async generate(request: StudioProviderRequest): Promise<StudioProviderResult> {
    assertStudioProviderRequest("SEKAI", request);
    const key = process.env.SEKAI_API_KEY?.trim();
    if (!key) throw new SekaiProviderError({ safeMessage: "Konfigurasi/autentikasi SEKAI tidak valid.", retryable: false, category: "AUTH", attempt: 0 });
    const idempotencyKey = this.uuid();
    const body = JSON.stringify({ model: request.model, prompt: request.prompt, n: 1, size: "1024x1024", quality: "low", response_format: "b64_json" });
    let finalError: SekaiProviderError | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const currentAttempt = attempt + 1;
      let response: Response;
      try {
        response = await this.fetcher(SEKAI_IMAGES_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        finalError = new SekaiProviderError({ safeMessage: isTimeout(error) ? "SEKAI melewati batas waktu." : "Tidak dapat terhubung ke layanan generation SEKAI.", retryable: true, category: isTimeout(error) ? "TIMEOUT" : "NETWORK", attempt: currentAttempt });
        if (attempt === MAX_ATTEMPTS - 1) throw finalError;
        await this.sleeper(retryDelay(attempt, null, this.random));
        continue;
      }
      const requestId = providerRequestId(response.headers);
      if (!response.ok) {
        finalError = failureForStatus(response.status, requestId, currentAttempt);
        await cancelResponseBody(response);
        if (!finalError.retryable || attempt === MAX_ATTEMPTS - 1) throw finalError;
        await this.sleeper(retryDelay(attempt, response.headers.get("retry-after"), this.random));
        continue;
      }
      const { payload, jsonParsed, bodyTooLarge, bodyBytes } = await readJsonWithLimit(response);
      try {
        const image = await decodeImage((payload as { data?: Array<{ b64_json?: unknown }> } | null)?.data?.[0]?.b64_json);
        return { providerRequestId: requestId, images: [image] };
      } catch {
        const retryable = !bodyTooLarge;
        console.error("AI Studio SEKAI invalid response", { attempt: currentAttempt, status: response.status, ...(requestId ? { providerRequestId: requestId } : {}), ...safeResponseShape(response, payload, jsonParsed, bodyTooLarge, bodyBytes) });
        finalError = new SekaiProviderError({ safeMessage: "SEKAI tidak mengembalikan gambar valid.", status: response.status, providerRequestId: requestId, retryable, category: "INVALID_RESPONSE", attempt: currentAttempt });
        if (!retryable || attempt === MAX_ATTEMPTS - 1) throw finalError;
        await this.sleeper(retryDelay(attempt, response.headers.get("retry-after"), this.random));
        continue;
      }
    }
    throw finalError ?? new SekaiProviderError({ safeMessage: "Tidak dapat terhubung ke layanan generation SEKAI.", retryable: true, category: "NETWORK", attempt: MAX_ATTEMPTS });
  }
}

export { SEKAI_IMAGES_URL, MAX_RETRY_DELAY_MS };
