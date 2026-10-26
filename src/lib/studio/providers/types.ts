export type StudioProviderRequest = { model: string; prompt: string; aspectRatio: string; outputCount: number; referenceImage?: Buffer };
export type StudioProviderImage = { data: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp" };
export type StudioProviderResult = { providerRequestId?: string; images: StudioProviderImage[] };
export interface StudioImageProvider { generate(request: StudioProviderRequest): Promise<StudioProviderResult>; }
export type StudioProviderErrorCategory = "AUTH" | "CREDIT" | "RATE_LIMIT" | "TIMEOUT" | "UPSTREAM" | "INVALID_REQUEST" | "INVALID_RESPONSE" | "NETWORK";
export type StudioProviderFailure = {
  safeMessage: string;
  status?: number;
  providerRequestId?: string;
  retryable: boolean;
  category: StudioProviderErrorCategory;
  attempt: number;
};

export const SEKAI_MODELS = [
  { model: "pixel/gpt-image-2", displayName: "GPT Image 2" },
  { model: "pixel/gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" },
  { model: "pixel/gemini-2.5-flash-image", displayName: "Gemini 2.5 Flash Image" },
] as const;
export const SEKAI_MODEL_IDS = new Set<string>(SEKAI_MODELS.map((item) => item.model));
export const GRIPHUB_MODELS = [
  { model: "gpt-image", displayName: "GPT Image" },
  { model: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" },
] as const;
export const GRIPHUB_MODEL_IDS = new Set<string>(GRIPHUB_MODELS.map((item) => item.model));

export type StudioProviderRule = { maxOutputCount: number; supportedAspectRatios?: readonly string[]; supportsReferenceImage?: boolean; models?: ReadonlySet<string> };

// Database rows control availability and pricing; this server-side policy prevents
// requests or a compromised row from widening a provider's technical limits.
export const STUDIO_PROVIDER_RULES: Readonly<Record<string, StudioProviderRule>> = {
  GEMINI: { maxOutputCount: 4 },
  LEONARDO: { maxOutputCount: 4, supportsReferenceImage: false },
  SEKAI: { maxOutputCount: 1, supportedAspectRatios: ["1:1"], supportsReferenceImage: false, models: SEKAI_MODEL_IDS },
  GRIPHUB: { maxOutputCount: 1, supportedAspectRatios: ["1:1", "3:2", "2:3"], supportsReferenceImage: false, models: GRIPHUB_MODEL_IDS },
};
export function isSupportedStudioProvider(provider: string) { return Object.hasOwn(STUDIO_PROVIDER_RULES, provider); }
export function assertStudioProviderRequest(provider: string, request: Pick<StudioProviderRequest, "model" | "aspectRatio" | "outputCount" | "referenceImage">) {
  const rule = STUDIO_PROVIDER_RULES[provider];
  if (!rule) throw new Error("Provider AI tidak didukung.");
  if (rule.models && !rule.models.has(request.model)) throw new Error("Model SEKAI tidak didukung.");
  if (request.outputCount < 1 || request.outputCount > rule.maxOutputCount) throw new Error("Jumlah output tidak didukung model ini.");
  if (rule.supportedAspectRatios && !rule.supportedAspectRatios.includes(request.aspectRatio)) throw new Error("Aspect ratio tidak didukung model ini.");
  if (request.referenceImage && rule.supportsReferenceImage === false) throw new Error("Model ini tidak mendukung reference image.");
}
