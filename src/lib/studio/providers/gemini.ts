import type { StudioImageProvider, StudioProviderRequest, StudioProviderResult } from "./types";

export class GeminiImageProvider implements StudioImageProvider {
  async generate(request: StudioProviderRequest): Promise<StudioProviderResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini belum dikonfigurasi pada server.");
    const parts: Array<Record<string, unknown>> = [{ text: `${request.prompt}\n\nGenerate exactly ${request.outputCount} image output(s) in aspect ratio ${request.aspectRatio}.` }];
    if (request.referenceImage) parts.push({ inlineData: { mimeType: "image/png", data: request.referenceImage.toString("base64") } });
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Gemini gagal (${response.status}).`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
    const images = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).flatMap((part) => part.inlineData?.data && [part.inlineData] || []).map((image) => {
      const mimeType: "image/png" | "image/jpeg" = image.mimeType === "image/png" ? "image/png" : "image/jpeg";
      return { data: Buffer.from(image.data!, "base64"), mimeType };
    }) ?? [];
    if (!images.length) throw new Error("Gemini tidak mengembalikan gambar.");
    return { images: images.slice(0, request.outputCount) };
  }
}
