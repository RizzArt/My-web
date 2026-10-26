import type { StudioImageProvider, StudioProviderRequest, StudioProviderResult } from "./types";

const dimensions: Record<string, [number, number]> = { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1152, 864], "3:4": [864, 1152] };
export class LeonardoImageProvider implements StudioImageProvider {
  async generate(request: StudioProviderRequest): Promise<StudioProviderResult> {
    if (request.referenceImage) throw new Error("Reference image Leonardo belum tersedia pada model ini.");
    const key = process.env.LEONARDO_API_KEY;
    if (!key) throw new Error("Leonardo belum dikonfigurasi pada server.");
    const [width, height] = dimensions[request.aspectRatio] ?? dimensions["1:1"];
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const created = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", { method: "POST", headers, body: JSON.stringify({ prompt: request.prompt, modelId: request.model, width, height, num_images: request.outputCount }), signal: AbortSignal.timeout(60_000) });
    if (!created.ok) throw new Error(`Leonardo gagal (${created.status}).`);
    const creation = await created.json() as { sdGenerationJob?: { generationId?: string } }; const id = creation.sdGenerationJob?.generationId;
    if (!id) throw new Error("Leonardo tidak mengembalikan ID generation.");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const status = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!status.ok) throw new Error(`Status Leonardo gagal (${status.status}).`);
      const payload = await status.json() as { generations_by_pk?: { status?: string; generated_images?: Array<{ url?: string }> } };
      if (payload.generations_by_pk?.status === "FAILED") throw new Error("Leonardo gagal membuat gambar.");
      const urls = payload.generations_by_pk?.generated_images?.map((image) => image.url).filter((url): url is string => Boolean(url)) ?? [];
      if (urls.length) {
        const images = await Promise.all(urls.slice(0, request.outputCount).map(async (url) => { const result = await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (!result.ok) throw new Error("Gagal mengunduh hasil Leonardo."); const mimeType: "image/png" | "image/jpeg" = result.headers.get("content-type")?.split(";")[0] === "image/png" ? "image/png" : "image/jpeg"; return { data: Buffer.from(await result.arrayBuffer()), mimeType }; }));
        return { providerRequestId: id, images };
      }
    }
    throw new Error("Leonardo melewati batas waktu generation.");
  }
}
