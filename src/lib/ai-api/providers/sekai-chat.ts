import type { AiApiChatMessage, AiApiChatTool } from "../validation";
import { strictToolArgumentsMatch } from "../tool-schema";

export const SEKAI_CHAT_URL = "https://api.sekaigateway.xyz/v1/chat/completions";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

type FetchLike = typeof fetch;
export type OpenAiCompatibleChatProviderOptions = { fetch?: FetchLike; endpoint?: string; credentialEnvName?: "SEKAI_API_KEY" | "GRIPHUB_API_KEY" };
export type SekaiChatRequest = {
  requestId: string;
  idempotencyKey: string;
  model: string;
  messages: AiApiChatMessage[];
  maxCompletionTokens?: number;
  temperature?: number;
  tools?: AiApiChatTool[];
  toolChoice?: "auto" | "none" | "required";
  parallelToolCalls?: boolean;
};
export type SekaiChatErrorCategory = "AUTH" | "CREDIT" | "RATE_LIMIT" | "INVALID_REQUEST" | "TIMEOUT" | "NETWORK" | "UPSTREAM" | "INVALID_RESPONSE" | "USAGE_MISSING";

export class SekaiChatProviderError extends Error {
  readonly category: SekaiChatErrorCategory;
  readonly status?: number;
  readonly definitelyUnbilled: boolean;
  readonly openBreaker: boolean;
  readonly providerRequestId?: string;

  constructor(input: { safeMessage: string; category: SekaiChatErrorCategory; definitelyUnbilled: boolean; openBreaker?: boolean; status?: number; providerRequestId?: string }) {
    super(input.safeMessage);
    this.name = "SekaiChatProviderError";
    this.category = input.category;
    this.status = input.status;
    this.definitelyUnbilled = input.definitelyUnbilled;
    this.openBreaker = input.openBreaker ?? !input.definitelyUnbilled;
    this.providerRequestId = input.providerRequestId;
  }
}

function providerRequestId(headers: Headers) {
  const value = headers.get("x-request-id") ?? headers.get("request-id");
  return value && /^[A-Za-z0-9._:/-]{1,200}$/.test(value) ? value : undefined;
}

async function cancelBody(response: Response) {
  try { await response.body?.cancel(); } catch { /* cancellation is best effort */ }
}

async function readJsonWithLimit(response: Response) {
  const declared = response.headers.get("content-length");
  if (declared && /^\d{1,12}$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    await cancelBody(response);
    throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, status: response.status, providerRequestId: providerRequestId(response.headers) });
  }
  if (!response.body) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, status: response.status, providerRequestId: providerRequestId(response.headers) });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, status: response.status, providerRequestId: providerRequestId(response.headers) });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    if (error instanceof SekaiChatProviderError) throw error;
    try { await reader.cancel(); } catch { /* ignore */ }
    throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, status: response.status, providerRequestId: providerRequestId(response.headers) });
  }
}

function statusError(response: Response) {
  const status = response.status;
  const requestId = providerRequestId(response.headers);
  // Once fetch has dispatched the request, no HTTP status is assumed unbilled
  // without an explicit provider contract. Client-shaped 4xx errors retain the
  // reservation for reconciliation but do not let one customer trip a global breaker.
  if (status === 401 || status === 403) return new SekaiChatProviderError({ safeMessage: "Autentikasi provider tidak valid.", category: "AUTH", definitelyUnbilled: false, openBreaker: true, status, providerRequestId: requestId });
  if (status === 402) return new SekaiChatProviderError({ safeMessage: "Saldo provider tidak mencukupi.", category: "CREDIT", definitelyUnbilled: false, openBreaker: true, status, providerRequestId: requestId });
  if (status === 429) return new SekaiChatProviderError({ safeMessage: "Provider sedang membatasi request.", category: "RATE_LIMIT", definitelyUnbilled: false, openBreaker: true, status, providerRequestId: requestId });
  if (status === 408) return new SekaiChatProviderError({ safeMessage: "Status biaya provider belum dapat dipastikan.", category: "TIMEOUT", definitelyUnbilled: false, openBreaker: false, status, providerRequestId: requestId });
  if (status >= 400 && status < 500) return new SekaiChatProviderError({ safeMessage: "Permintaan ditolak provider.", category: "INVALID_REQUEST", definitelyUnbilled: false, openBreaker: false, status, providerRequestId: requestId });
  return new SekaiChatProviderError({ safeMessage: "Status biaya provider belum dapat dipastikan.", category: "UPSTREAM", definitelyUnbilled: false, status, providerRequestId: requestId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

function normalizeResponse(payload: unknown, request: SekaiChatRequest, requestId?: string) {
  if (!isRecord(payload)) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: requestId });
  const payloadRequestId = typeof payload.id === "string" && /^[A-Za-z0-9._:/-]{1,200}$/.test(payload.id) ? payload.id : undefined;
  if (requestId && payloadRequestId && requestId !== payloadRequestId) throw new SekaiChatProviderError({ safeMessage: "Identitas respons provider tidak konsisten.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: requestId });
  const authoritativeRequestId = requestId ?? payloadRequestId;
  if (!authoritativeRequestId) throw new SekaiChatProviderError({ safeMessage: "Identitas respons provider tidak tersedia.", category: "INVALID_RESPONSE", definitelyUnbilled: false });
  if (!Array.isArray(payload.choices) || payload.choices.length !== 1) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
  if (payload.model !== request.model) throw new SekaiChatProviderError({ safeMessage: "Model respons provider tidak cocok.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
  const usage = isRecord(payload.usage) ? payload.usage : null;
  const promptTokens = safeInteger(usage?.prompt_tokens);
  const completionTokens = safeInteger(usage?.completion_tokens);
  if (promptTokens === null || completionTokens === null) throw new SekaiChatProviderError({ safeMessage: "Usage provider tidak tersedia.", category: "USAGE_MISSING", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
  const declaredTools = new Map(request.tools?.map((tool) => [tool.function.name, tool]) ?? []);
  const choices = payload.choices.map((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message) || choice.message.role !== "assistant") throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    const content = choice.message.content === null ? null : typeof choice.message.content === "string" ? choice.message.content : undefined;
    const rawToolCalls = choice.message.tool_calls;
    if (rawToolCalls !== undefined && (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0 || rawToolCalls.length > 32)) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls.map((toolCall) => {
      if (!isRecord(toolCall) || typeof toolCall.id !== "string" || !/^[A-Za-z0-9._:/-]{1,200}$/.test(toolCall.id) || toolCall.type !== "function" || !isRecord(toolCall.function) || typeof toolCall.function.name !== "string" || !declaredTools.has(toolCall.function.name) || typeof toolCall.function.arguments !== "string") throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
      let argumentsValue: unknown;
      try { argumentsValue = JSON.parse(toolCall.function.arguments); } catch { throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId }); }
      if (!isRecord(argumentsValue)) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
      const declaredTool = declaredTools.get(toolCall.function.name);
      if (declaredTool?.function.strict === true) {
        try {
          if (!strictToolArgumentsMatch(declaredTool.function.parameters, argumentsValue)) throw new Error("invalid");
        } catch {
          throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
        }
      }
      return { id: toolCall.id, type: "function" as const, function: { name: toolCall.function.name, arguments: toolCall.function.arguments } };
    }) : undefined;
    if (content === undefined || (!content && !toolCalls?.length)) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak valid.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    const finishReason = choice.finish_reason;
    if (finishReason !== "stop" && finishReason !== "tool_calls") throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak lengkap.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    if ((finishReason === "tool_calls") !== Boolean(toolCalls?.length)) throw new SekaiChatProviderError({ safeMessage: "Respons provider tidak konsisten.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    if (request.toolChoice === "none" && toolCalls?.length) throw new SekaiChatProviderError({ safeMessage: "Respons provider melanggar kebijakan tool.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    if (request.toolChoice === "required" && !toolCalls?.length) throw new SekaiChatProviderError({ safeMessage: "Respons provider melanggar kebijakan tool.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    if (request.parallelToolCalls === false && (toolCalls?.length ?? 0) > 1) throw new SekaiChatProviderError({ safeMessage: "Respons provider melanggar kebijakan parallel tool.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    if (toolCalls && new Set(toolCalls.map((toolCall) => toolCall.id)).size !== toolCalls.length) throw new SekaiChatProviderError({ safeMessage: "Respons provider memiliki call ID duplikat.", category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: authoritativeRequestId });
    return {
      index: typeof choice.index === "number" && Number.isSafeInteger(choice.index) ? choice.index : 0,
      finish_reason: finishReason,
      message: { role: "assistant" as const, content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
    };
  });
  return {
    promptTokens,
    completionTokens,
    providerRequestId: authoritativeRequestId,
    response: {
      id: authoritativeRequestId,
      object: "chat.completion",
      created: typeof payload.created === "number" && Number.isSafeInteger(payload.created) ? payload.created : Math.floor(Date.now() / 1000),
      model: request.model,
      choices,
      usage: { prompt_tokens: Number(promptTokens), completion_tokens: Number(completionTokens), total_tokens: Number(promptTokens + completionTokens) },
    },
  };
}

export class SekaiChatProvider {
  private readonly fetcher: FetchLike;
  private readonly endpoint: string;
  private readonly credentialEnvName: "SEKAI_API_KEY" | "GRIPHUB_API_KEY";
  constructor(options: OpenAiCompatibleChatProviderOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? SEKAI_CHAT_URL;
    this.credentialEnvName = options.credentialEnvName ?? "SEKAI_API_KEY";
  }

  async complete(request: SekaiChatRequest) {
    const key = process.env[this.credentialEnvName]?.trim();
    if (!key) throw new SekaiChatProviderError({ safeMessage: "Autentikasi provider tidak valid.", category: "AUTH", definitelyUnbilled: true, openBreaker: true });
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          ...(request.maxCompletionTokens === undefined ? {} : { max_tokens: request.maxCompletionTokens }),
          stream: false,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.tools?.length ? { tools: request.tools } : {}),
          ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
          ...(request.parallelToolCalls === undefined ? {} : { parallel_tool_calls: request.parallelToolCalls }),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new SekaiChatProviderError({ safeMessage: "Status biaya provider belum dapat dipastikan.", category: timeout ? "TIMEOUT" : "NETWORK", definitelyUnbilled: false });
    }
    const requestId = providerRequestId(response.headers);
    if (!response.ok) {
      const error = statusError(response);
      await cancelBody(response);
      throw error;
    }
    const payload = await readJsonWithLimit(response);
    return normalizeResponse(payload, request, requestId);
  }
}
