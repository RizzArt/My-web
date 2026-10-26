import { describe, expect, it } from "vitest";
import { AI_API_CATALOG, catalogModel, validateCatalogIntegrity } from "@/lib/ai-api/catalog";
import { parseChatRequest } from "@/lib/ai-api/validation";

describe("current API offering versus retained financial history", () => {
  it("offers only the three retained mappings with neutral model names", () => {
    expect(AI_API_CATALOG.map(({ id, provider, displayName }) => ({ id, provider, displayName }))).toEqual([
      { id: "griphub/minimax-m3", provider: "GRIPHUB", displayName: "MiniMax M3" },
      { id: "griphub/gpt-5.6-terra", provider: "GRIPHUB", displayName: "GPT-5.6 Terra" },
      { id: "griphub/gpt-5.6-sol", provider: "GRIPHUB", displayName: "GPT-5.6 Sol" },
    ]);
    expect(validateCatalogIntegrity()).toBe(true);
  });

  it.each(["minimax/minimax-m3", "gemini/gemini-3.8-flash-high", "cx/gpt-5.6-sol", "cc/claude-opus-5"])("retains historical parsing and model identity for safe retry: %s", (id) => {
    expect(catalogModel(id)).toMatchObject({ id, provider: "SEKAI", upstreamModelId: id });
    expect(parseChatRequest({ model: id, messages: [{ role: "user", content: "history retry fixture" }], max_tokens: 32 }).model).toBe(id);
  });
});
