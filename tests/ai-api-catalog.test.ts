import { describe, expect, it } from "vitest";
import { AI_API_CATALOG, LEGACY_AI_API_CATALOG, catalogModel, validateCatalogIntegrity } from "@/lib/ai-api/catalog";
import { estimateInputTokenUpperBound, parseChatRequest } from "@/lib/ai-api/validation";

describe("Riezz99 AI API catalog and request boundary", () => {
  it("contains approved SEKAI history plus disabled-ready Griphub model mappings", () => {
    expect([...LEGACY_AI_API_CATALOG, ...AI_API_CATALOG].map((item) => item.id)).toEqual([
      "minimax/minimax-m3",
      "gemini/gemini-3.8-flash-high",
      "cx/gpt-5.6-sol",
      "cc/claude-opus-5",
      "griphub/minimax-m3",
      "griphub/gpt-5.6-terra",
      "griphub/gpt-5.6-sol",
    ]);
    expect(validateCatalogIntegrity()).toBe(true);
    expect(catalogModel("unapproved/model")).toBeNull();
    expect(catalogModel("griphub/minimax-m3")).toMatchObject({ provider: "GRIPHUB", upstreamModelId: "minimax-m3", providerMaxInputTokens: 32_768, providerMaxOutputTokens: 512_000 });
  });

  it("keeps private-beta output limits below provider maxima", () => {
    for (const model of AI_API_CATALOG) {
      expect(model.privateBetaMaxOutputTokens).toBeLessThanOrEqual(model.providerMaxOutputTokens);
      expect(model.privateBetaMaxOutputTokens).toBeLessThanOrEqual(8_192);
    }
  });

  it("accepts bounded text-only non-streaming chat requests", () => {
    const parsed = parseChatRequest({
      model: "minimax/minimax-m3",
      messages: [{ role: "user", content: "Halo" }],
      max_tokens: 128,
    });
    expect(parsed.model).toBe("minimax/minimax-m3");
    expect(parsed.maxCompletionTokens).toBe(128);
    expect(estimateInputTokenUpperBound(parsed.messages)).toBeGreaterThanOrEqual(Buffer.byteLength("Halo"));
  });

  it("rejects streaming, arbitrary models, multimodal content, and data/private URLs", () => {
    expect(() => parseChatRequest({ model: "minimax/minimax-m3", messages: [{ role: "user", content: "x" }], stream: true })).toThrow("stream");
    expect(() => parseChatRequest({ model: "other", messages: [{ role: "user", content: "x" }] })).toThrow(/model/i);
    expect(() => parseChatRequest({ model: "minimax/minimax-m3", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] })).toThrow("teks");
    expect(() => parseChatRequest({ model: "minimax/minimax-m3", messages: [{ role: "user", content: "data:image/png;base64,AAAA" }] })).toThrow("URL");
    expect(() => parseChatRequest({ model: "minimax/minimax-m3", messages: [{ role: "user", content: "http://127.0.0.1/private" }] })).toThrow("URL");
  });
});
