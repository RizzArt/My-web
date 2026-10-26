import { GeminiImageProvider } from "./gemini";
import { LeonardoImageProvider } from "./leonardo";
import { SekaiImageProvider } from "./sekai";
import type { StudioImageProvider } from "./types";
export function getStudioProvider(provider: string): StudioImageProvider {
  if (provider === "GEMINI") return new GeminiImageProvider();
  if (provider === "LEONARDO") return new LeonardoImageProvider();
  if (provider === "SEKAI") return new SekaiImageProvider();
  throw new Error("Provider AI tidak didukung.");
}
