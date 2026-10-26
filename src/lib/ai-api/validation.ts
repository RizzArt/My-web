import { catalogModel } from "./catalog";

export type AiApiChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type AiApiChatMessage =
  | { role: "system" | "developer" | "user" | "assistant"; content: string | null; tool_calls?: AiApiChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export type AiApiChatTool = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean };
};
export type ParsedChatRequest = {
  model: string;
  messages: AiApiChatMessage[];
  maxCompletionTokens: number;
  maxCompletionTokensExplicit?: boolean;
  temperature?: number;
  tools?: AiApiChatTool[];
  toolChoice?: "auto" | "none" | "required";
  parallelToolCalls?: boolean;
};

const FORBIDDEN_URL = /(?:data:|file:|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?))/i;
const MAX_MESSAGES = 128;
const DEFAULT_MAX_COMPLETION_TOKENS = 1_024;
const PROVIDER_PROMPT_OVERHEAD_TOKEN_UPPER_BOUND = 8_192;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function estimateInputTokenUpperBound(messages: AiApiChatMessage[]) {
  const bytes = messages.reduce((sum, message) => {
    const content = message.content ?? "";
    const toolBytes = "tool_calls" in message && message.tool_calls
      ? Buffer.byteLength(JSON.stringify(message.tool_calls))
      : "tool_call_id" in message
        ? Buffer.byteLength(message.tool_call_id)
        : 0;
    return sum + Buffer.byteLength(message.role) + Buffer.byteLength(content) + toolBytes;
  }, 0);
  return BigInt(bytes + messages.length * 32 + 512 + PROVIDER_PROMPT_OVERHEAD_TOKEN_UPPER_BOUND);
}

export function parseChatRequest(value: unknown): ParsedChatRequest {
  if (!record(value)) throw new Error("Payload tidak valid.");
  if (value.stream === true) throw new Error("Mode stream belum didukung.");
  const model = typeof value.model === "string" ? catalogModel(value.model) : null;
  if (!model) throw new Error("Model tidak tersedia.");
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > MAX_MESSAGES) throw new Error("Daftar messages tidak valid.");
  const messages = value.messages.map((item) => {
    if (!record(item) || !["system", "user", "assistant"].includes(String(item.role)) || typeof item.content !== "string") throw new Error("Private beta hanya mendukung pesan teks.");
    if (!item.content || FORBIDDEN_URL.test(item.content)) throw new Error("URL privat, file, atau data URL tidak didukung.");
    return { role: item.role as "system" | "user" | "assistant", content: item.content };
  });
  const requestBytes = Buffer.byteLength(JSON.stringify({ model: model.id, messages }));
  if (requestBytes > model.maxRequestBytes) throw new Error("Payload terlalu besar.");
  const rawMax = value.max_completion_tokens ?? value.max_tokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  if (!Number.isInteger(rawMax) || Number(rawMax) <= 0 || Number(rawMax) > model.privateBetaMaxOutputTokens) throw new Error("max_tokens tidak valid.");
  if (value.temperature !== undefined && (typeof value.temperature !== "number" || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) throw new Error("temperature tidak valid.");
  const inputUpperBound = estimateInputTokenUpperBound(messages);
  if (inputUpperBound + BigInt(Number(rawMax)) > BigInt(model.providerMaxInputTokens)) throw new Error("Context window terlampaui.");
  return { model: model.id, messages, maxCompletionTokens: Number(rawMax), maxCompletionTokensExplicit: true, ...(value.temperature === undefined ? {} : { temperature: value.temperature }) };
}
