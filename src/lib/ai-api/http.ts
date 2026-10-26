import { AiApiError } from "./service";

export { AiApiError } from "./service";

export async function readRequestTextWithLimit(request: Request, maxBytes: number, timeoutMs = 10_000) {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    try { await request.body?.cancel(); } catch { /* best effort */ }
    throw new AiApiError("request_too_large", "Payload terlalu besar.", 413);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AiApiError("request_timeout", "Waktu pengiriman payload habis.", 408));
      void reader.cancel().catch(() => undefined);
    }, timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new AiApiError("request_too_large", "Payload terlalu besar.", 413);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw new AiApiError("invalid_json", "JSON tidak valid.", 400);
    }
  } catch (error) {
    if (error instanceof AiApiError) throw error;
    try { await reader.cancel(); } catch { /* best effort */ }
    throw new AiApiError("invalid_request", "Request tidak valid.", 400);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
