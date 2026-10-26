export type AiApiCatalogModel = {
  id: string;
  provider: "SEKAI" | "GRIPHUB";
  upstreamModelId: string;
  displayName: string;
  providerMaxInputTokens: number;
  providerMaxOutputTokens: number;
  privateBetaMaxOutputTokens: number;
  maxRequestBytes: number;
};

const CODEX_COMPATIBLE_MAX_REQUEST_BYTES = 960 * 1024;

// Historical identity is retained for idempotent retry and financial recovery,
// never as evidence that a retired provider can accept new work.
export const LEGACY_AI_API_CATALOG: readonly AiApiCatalogModel[] = Object.freeze([
  { id: "minimax/minimax-m3", provider: "SEKAI", upstreamModelId: "minimax/minimax-m3", displayName: "MiniMax M3", providerMaxInputTokens: 1_000_000, providerMaxOutputTokens: 262_144, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
  { id: "gemini/gemini-3.8-flash-high", provider: "SEKAI", upstreamModelId: "gemini/gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash", providerMaxInputTokens: 1_000_000, providerMaxOutputTokens: 65_536, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
  { id: "cx/gpt-5.6-sol", provider: "SEKAI", upstreamModelId: "cx/gpt-5.6-sol", displayName: "GPT-5.6 Sol", providerMaxInputTokens: 1_050_000, providerMaxOutputTokens: 128_000, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
  { id: "cc/claude-opus-5", provider: "SEKAI", upstreamModelId: "cc/claude-opus-5", displayName: "Claude Opus 5", providerMaxInputTokens: 1_000_000, providerMaxOutputTokens: 128_000, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
]);

export const AI_API_CATALOG: readonly AiApiCatalogModel[] = Object.freeze([
  // Griphub only documents max output in its authenticated model catalog. Input is
  // intentionally capped to 32K by Riezz99 until Griphub publishes a context limit.
  { id: "griphub/minimax-m3", provider: "GRIPHUB", upstreamModelId: "minimax-m3", displayName: "MiniMax M3", providerMaxInputTokens: 32_768, providerMaxOutputTokens: 512_000, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
  { id: "griphub/gpt-5.6-terra", provider: "GRIPHUB", upstreamModelId: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", providerMaxInputTokens: 32_768, providerMaxOutputTokens: 128_000, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
  { id: "griphub/gpt-5.6-sol", provider: "GRIPHUB", upstreamModelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", providerMaxInputTokens: 32_768, providerMaxOutputTokens: 128_000, privateBetaMaxOutputTokens: 8_192, maxRequestBytes: CODEX_COMPATIBLE_MAX_REQUEST_BYTES },
]);

export function catalogModel(id: string) {
  return AI_API_CATALOG.find((item) => item.id === id)
    ?? LEGACY_AI_API_CATALOG.find((item) => item.id === id)
    ?? null;
}

export function validateCatalogIntegrity() {
  const history = [...LEGACY_AI_API_CATALOG, ...AI_API_CATALOG];
  const ids = history.map((item) => item.id);
  return AI_API_CATALOG.length === 3
    && AI_API_CATALOG.every((item) => item.provider === "GRIPHUB")
    && LEGACY_AI_API_CATALOG.length === 4
    && LEGACY_AI_API_CATALOG.every((item) => item.provider === "SEKAI")
    && ids.length === 7
    && new Set(ids).size === ids.length
    && history.every((item) => item.privateBetaMaxOutputTokens > 0
      && (item.provider === "SEKAI" || item.provider === "GRIPHUB")
      && item.upstreamModelId.length > 0
      && item.privateBetaMaxOutputTokens <= item.providerMaxOutputTokens
      && item.maxRequestBytes > 0);
}
