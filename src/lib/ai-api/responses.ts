import { createHash } from "node:crypto";
import { catalogModel } from "./catalog";
import { requestFingerprint, validateIdempotencyKey } from "./idempotency";
import { compileStrictToolSchema, strictToolArgumentsMatch } from "./tool-schema";
import type { AiApiChatMessage, AiApiChatTool, ParsedChatRequest } from "./validation";

const PROVIDER_PROMPT_OVERHEAD_TOKEN_UPPER_BOUND = 8_192;
const RESPONSE_FRAMING_BYTES = 512;
const MAX_RESPONSE_INPUT_ITEMS = 512;
const MAX_RESPONSE_TOOLS = 256;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const CODEX_TURN_ID = /^[A-Za-z0-9-]{16,80}$/;
const MAX_CODEX_METADATA_BYTES = 16 * 1024;
const RESPONSE_FIELDS = new Set([
  "model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls", "max_output_tokens", "stream", "store",
  "reasoning", "include", "prompt_cache_key", "client_metadata", "previous_response_id", "text", "service_tier",
]);
const MESSAGE_FIELDS = new Set(["type", "id", "role", "content", "status"]);
const CONTENT_PART_FIELDS = new Set(["type", "text"]);
const FUNCTION_TOOL_FIELDS = new Set(["type", "name", "description", "parameters", "strict"]);
const NAMESPACE_TOOL_FIELDS = new Set(["type", "name", "description", "tools"]);
const FUNCTION_CALL_FIELDS = new Set(["type", "id", "call_id", "namespace", "name", "arguments", "status"]);
const FUNCTION_OUTPUT_FIELDS = new Set(["type", "id", "call_id", "output", "status"]);

type ToolAlias = { namespace?: string; name: string; kind: "function" | "custom"; parameters?: Record<string, unknown>; strict?: boolean };

export function responsesIdempotencyKey(headerValue: string | null | undefined, requestValue: unknown, codexTurnMetadata: string | null | undefined) {
  if (headerValue) return validateIdempotencyKey(headerValue);
  if (!codexTurnMetadata || Buffer.byteLength(codexTurnMetadata, "utf8") > MAX_CODEX_METADATA_BYTES) throw new Error("Idempotency-Key wajib untuk klien selain Codex.");
  let metadata: unknown;
  try { metadata = JSON.parse(codexTurnMetadata); } catch { throw new Error("metadata Codex tidak valid."); }
  if (!record(metadata) || typeof metadata.turn_id !== "string" || !CODEX_TURN_ID.test(metadata.turn_id)) throw new Error("metadata Codex tidak valid.");
  return `codex:${metadata.turn_id}:${requestFingerprint(requestValue)}`;
}

export type ParsedResponsesRequest = {
  stream: boolean;
  chatRequest: ParsedChatRequest;
  toolAliases: Map<string, ToolAlias>;
  inputTokenUpperBound: bigint;
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNestedFields(value: Record<string, unknown>, allowed: Set<string>) {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`Field nested Responses API belum didukung: ${unsupported}.`);
}

function assertOptionalItemMetadata(value: Record<string, unknown>) {
  if (value.id !== undefined && (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 200)) throw new Error("ID item Responses tidak valid.");
  if (value.status !== undefined && value.status !== "completed") throw new Error("Field nested Responses API belum didukung: status.");
}

function textContent(value: unknown, allowedPartType: "input_text" | "output_text") {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length === 0) throw new Error("Konten message tidak valid.");
  return value.map((part) => {
    if (!record(part) || part.type !== allowedPartType || typeof part.text !== "string") {
      throw new Error("Responses API saat ini hanya mendukung konten teks.");
    }
    assertNestedFields(part, CONTENT_PART_FIELDS);
    return part.text;
  }).join("\n");
}

function aliasName(namespace: string | undefined, name: string, used: Set<string>) {
  const preferred = namespace ? `${namespace}__${name}` : name;
  if (TOOL_NAME.test(preferred) && !used.has(preferred)) return preferred;
  const normalized = preferred.replace(/[^A-Za-z0-9_-]/g, "_");
  const digest = createHash("sha256").update(preferred).digest("hex").slice(0, 10);
  const prefix = normalized.slice(0, Math.max(1, 53));
  const candidate = `${prefix}_${digest}`;
  if (used.has(candidate)) throw new Error("Nama tool bertabrakan.");
  return candidate;
}

function parseFunctionTool(value: Record<string, unknown>, namespace: string | undefined, tools: AiApiChatTool[], aliases: Map<string, ToolAlias>, used: Set<string>, publicIdentities: Set<string>) {
  assertNestedFields(value, FUNCTION_TOOL_FIELDS);
  if (tools.length >= MAX_RESPONSE_TOOLS) throw new Error("Daftar tools tidak valid.");
  if (typeof value.name !== "string" || !value.name || value.name.length > 200) throw new Error("Nama tool tidak valid.");
  if (!record(value.parameters)) throw new Error("Schema tool tidak valid.");
  if (value.description !== undefined && typeof value.description !== "string") throw new Error("Deskripsi tool tidak valid.");
  if (value.strict !== undefined && typeof value.strict !== "boolean") throw new Error("Mode strict tool tidak valid.");
  if (value.strict === true) compileStrictToolSchema(value.parameters);
  const publicIdentity = JSON.stringify([namespace ?? null, value.name]);
  if (publicIdentities.has(publicIdentity)) throw new Error("Identitas tool duplikat.");
  publicIdentities.add(publicIdentity);
  const alias = aliasName(namespace, value.name, used);
  used.add(alias);
  aliases.set(alias, {
    ...(namespace ? { namespace } : {}),
    name: value.name,
    kind: "function",
    parameters: value.parameters,
    strict: value.strict === true,
  });
  tools.push({
    type: "function",
    function: {
      name: alias,
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      parameters: value.parameters,
      ...(typeof value.strict === "boolean" ? { strict: value.strict } : {}),
    },
  });
}

function parseTools(value: unknown) {
  const tools: AiApiChatTool[] = [];
  const aliases = new Map<string, ToolAlias>();
  const used = new Set<string>();
  const publicIdentities = new Set<string>();
  if (value === undefined) return { tools, aliases };
  if (!Array.isArray(value) || value.length > MAX_RESPONSE_TOOLS) throw new Error("Daftar tools tidak valid.");
  for (const item of value) {
    if (!record(item) || typeof item.type !== "string") throw new Error("Tool tidak valid.");
    if (item.type === "web_search") throw new Error("web_search belum didukung; atur web_search = \"disabled\" pada Codex.");
    if (item.type === "function") {
      parseFunctionTool(item, undefined, tools, aliases, used, publicIdentities);
      continue;
    }
    if (item.type === "namespace") {
      assertNestedFields(item, NAMESPACE_TOOL_FIELDS);
      if (typeof item.name !== "string" || !item.name || item.name.length > 200 || !Array.isArray(item.tools)) throw new Error("Namespace tool tidak valid.");
      if (item.description !== undefined && typeof item.description !== "string") throw new Error("Deskripsi namespace tidak valid.");
      for (const nested of item.tools) {
        if (!record(nested) || nested.type !== "function") throw new Error("Namespace hanya mendukung function tool.");
        parseFunctionTool(nested, item.name, tools, aliases, used, publicIdentities);
      }
      continue;
    }
    throw new Error("Jenis tool belum didukung.");
  }
  return { tools, aliases };
}

export function parseResponsesRequest(value: unknown): ParsedResponsesRequest {
  if (!record(value)) throw new Error("Payload tidak valid.");
  const unsupportedField = Object.keys(value).find((key) => !RESPONSE_FIELDS.has(key));
  if (unsupportedField) throw new Error(`Field Responses API belum didukung: ${unsupportedField}.`);
  if (value.previous_response_id !== undefined) throw new Error("previous_response_id belum didukung.");
  if (value.text !== undefined) throw new Error("text belum didukung.");
  if (value.service_tier !== undefined) throw new Error("service_tier belum didukung.");
  if (value.store === true) throw new Error("store=true belum didukung.");
  if (value.store !== undefined && value.store !== false) throw new Error("store tidak valid.");
  if (value.reasoning !== undefined && (!record(value.reasoning) || Object.keys(value.reasoning).length !== 1 || value.reasoning.summary !== "auto")) throw new Error("reasoning belum didukung.");
  if (value.include !== undefined && (!Array.isArray(value.include) || value.include.length !== 1 || value.include[0] !== "reasoning.encrypted_content")) throw new Error("include belum didukung.");
  if (value.prompt_cache_key !== undefined && (typeof value.prompt_cache_key !== "string" || value.prompt_cache_key.length < 1 || value.prompt_cache_key.length > 200)) throw new Error("prompt_cache_key tidak valid.");
  if (value.client_metadata !== undefined) {
    if (!record(value.client_metadata) || Object.keys(value.client_metadata).length > 20 || Buffer.byteLength(JSON.stringify(value.client_metadata), "utf8") > MAX_CODEX_METADATA_BYTES) throw new Error("client_metadata tidak valid.");
    for (const [key, item] of Object.entries(value.client_metadata)) {
      if (key.length < 1 || key.length > 100 || typeof item !== "string" || item.length > 8_192) throw new Error("client_metadata tidak valid.");
    }
  }
  const model = typeof value.model === "string" ? catalogModel(value.model) : null;
  if (!model) throw new Error("Model tidak tersedia.");
  if (value.stream !== undefined && typeof value.stream !== "boolean") throw new Error("Nilai stream tidak valid.");
  if (value.instructions !== undefined && (typeof value.instructions !== "string" || value.instructions.length === 0)) throw new Error("Instructions tidak valid.");
  const inputItems = typeof value.input === "string"
    ? [{ type: "message", role: "user", content: value.input }]
    : value.input;
  if (!Array.isArray(inputItems) || inputItems.length === 0 || inputItems.length > MAX_RESPONSE_INPUT_ITEMS) throw new Error("Input tidak valid.");

  const parsedTools = parseTools(value.tools);
  const messages: AiApiChatMessage[] = [];
  const knownCalls = new Set<string>();
  const completedCalls = new Set<string>();
  const pendingCalls = new Set<string>();
  let toolPhase: "messages" | "calls" | "outputs" = "messages";
  const aliasFor = (namespace: string | undefined, name: string) => {
    for (const [alias, metadata] of parsedTools.aliases) {
      if (metadata.name === name && metadata.namespace === namespace) return alias;
    }
    return null;
  };
  if (typeof value.instructions === "string" && value.instructions) messages.push({ role: "system", content: value.instructions });
  for (const item of inputItems) {
    if (!record(item) || typeof item.type !== "string") throw new Error("Item input belum didukung.");
    if (item.type === "message") {
      assertNestedFields(item, MESSAGE_FIELDS);
      assertOptionalItemMetadata(item);
      if (pendingCalls.size > 0) throw new Error("function_call_output wajib diselesaikan sebelum message berikutnya.");
      if (!["system", "developer", "user", "assistant"].includes(String(item.role))) throw new Error("Role message tidak valid.");
      const content = textContent(item.content, item.role === "assistant" ? "output_text" : "input_text");
      if (!content) throw new Error("Konten message tidak boleh kosong.");
      const role = item.role as "system" | "developer" | "user" | "assistant";
      messages.push({ role, content });
      toolPhase = "messages";
      continue;
    }
    if (item.type === "function_call") {
      assertNestedFields(item, FUNCTION_CALL_FIELDS);
      assertOptionalItemMetadata(item);
      if (toolPhase === "outputs" && pendingCalls.size > 0) throw new Error("Urutan function call tidak valid.");
      if (typeof item.call_id !== "string" || !item.call_id || item.call_id.length > 200 || typeof item.name !== "string" || typeof item.arguments !== "string") throw new Error("Function call tidak valid.");
      if (knownCalls.has(item.call_id)) throw new Error("Function call call_id duplikat.");
      const namespace = item.namespace === undefined ? undefined : typeof item.namespace === "string" ? item.namespace : null;
      if (namespace === null) throw new Error("Namespace function call tidak valid.");
      let argumentsValue: unknown;
      try { argumentsValue = JSON.parse(item.arguments); } catch { throw new Error("Arguments function call tidak valid."); }
      if (!record(argumentsValue)) throw new Error("Arguments function call tidak valid.");
      const alias = aliasFor(namespace, item.name);
      if (!alias) throw new Error("Function call tidak cocok dengan daftar tools.");
      const metadata = parsedTools.aliases.get(alias);
      if (metadata?.strict === true && (!metadata.parameters || !strictToolArgumentsMatch(metadata.parameters, argumentsValue))) {
        throw new Error("Arguments function call melanggar schema strict.");
      }
      knownCalls.add(item.call_id);
      pendingCalls.add(item.call_id);
      toolPhase = "calls";
      const toolCall = { id: item.call_id, type: "function" as const, function: { name: alias, arguments: item.arguments } };
      const previous = messages.at(-1);
      if (previous?.role === "assistant" && previous.content === null && previous.tool_calls) previous.tool_calls.push(toolCall);
      else messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
      continue;
    }
    if (item.type === "function_call_output") {
      assertNestedFields(item, FUNCTION_OUTPUT_FIELDS);
      assertOptionalItemMetadata(item);
      if (typeof item.call_id !== "string" || !knownCalls.has(item.call_id) || !pendingCalls.has(item.call_id) || completedCalls.has(item.call_id) || typeof item.output !== "string") throw new Error("function_call_output tidak cocok.");
      pendingCalls.delete(item.call_id);
      completedCalls.add(item.call_id);
      toolPhase = "outputs";
      messages.push({ role: "tool", tool_call_id: item.call_id, content: item.output });
      continue;
    }
    throw new Error("Item input belum didukung.");
  }
  if (pendingCalls.size > 0) throw new Error("function_call_output wajib diselesaikan.");

  const maxCompletionTokensExplicit = value.max_output_tokens !== undefined;
  const rawMax = value.max_output_tokens ?? model.privateBetaMaxOutputTokens;
  if (!Number.isInteger(rawMax) || Number(rawMax) <= 0 || Number(rawMax) > model.privateBetaMaxOutputTokens) throw new Error("max_output_tokens tidak valid.");
  const toolChoice = value.tool_choice === undefined ? "auto" : value.tool_choice;
  if (!["auto", "none", "required"].includes(String(toolChoice))) throw new Error("tool_choice tidak valid.");
  if (toolChoice === "required" && parsedTools.tools.length === 0) throw new Error("tool_choice required memerlukan function tool yang didukung.");
  if (value.parallel_tool_calls !== undefined && typeof value.parallel_tool_calls !== "boolean") throw new Error("parallel_tool_calls tidak valid.");
  if (value.parallel_tool_calls === false) throw new Error("parallel_tool_calls=false belum didukung.");

  const requestBytes = Buffer.byteLength(JSON.stringify(value));
  if (requestBytes > model.maxRequestBytes) throw new Error("Payload terlalu besar.");
  const inputTokenUpperBound = BigInt(requestBytes + RESPONSE_FRAMING_BYTES + PROVIDER_PROMPT_OVERHEAD_TOKEN_UPPER_BOUND);
  if (inputTokenUpperBound + BigInt(Number(rawMax)) > BigInt(model.providerMaxInputTokens)) throw new Error("Context window terlampaui.");

  return {
    stream: value.stream === true,
    chatRequest: {
      model: model.id,
      messages,
      maxCompletionTokens: Number(rawMax),
      maxCompletionTokensExplicit,
      ...(parsedTools.tools.length > 0 ? { tools: parsedTools.tools } : {}),
      ...(value.tool_choice === undefined ? {} : { toolChoice: toolChoice as "auto" | "none" | "required" }),
      ...(typeof value.parallel_tool_calls === "boolean" ? { parallelToolCalls: value.parallel_tool_calls } : {}),
    },
    toolAliases: parsedTools.aliases,
    inputTokenUpperBound,
  };
}

type ChatCompletionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    message: { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

type ResponseMessageItem = {
  id: string;
  type: "message";
  role: "assistant";
  status: "completed";
  content: Array<{ type: "output_text"; text: string; annotations: never[] }>;
};

type ResponseFunctionCallItem = {
  id: string;
  type: "function_call";
  call_id: string;
  namespace?: string;
  name: string;
  arguments: string;
  status: "completed";
};

export type AiApiResponseObject = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  model: string;
  output: Array<ResponseMessageItem | ResponseFunctionCallItem>;
  usage: {
    input_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  };
};

export function responseFromChatCompletion(input: { requestId: string; aliases: Map<string, ToolAlias>; chatResponse: ChatCompletionResponse; publicModel?: string }): AiApiResponseObject {
  const choice = input.chatResponse.choices[0];
  if (!choice) throw new Error("Respons provider tidak memiliki choice.");
  const output: Array<ResponseMessageItem | ResponseFunctionCallItem> = [];
  if (typeof choice.message.content === "string" && choice.message.content) {
    output.push({
      id: `msg_${input.requestId}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: choice.message.content, annotations: [] }],
    });
  }
  for (const [index, toolCall] of (choice.message.tool_calls ?? []).entries()) {
    const metadata = input.aliases.get(toolCall.function.name);
    if (!metadata || metadata.kind !== "function") throw new Error("Tool call provider tidak dikenal.");
    let argumentsValue: unknown;
    try { argumentsValue = JSON.parse(toolCall.function.arguments); } catch { throw new Error("Arguments tool call provider tidak valid."); }
    if (!record(argumentsValue)) throw new Error("Arguments tool call provider tidak valid.");
    if (metadata.strict === true) {
      if (!metadata.parameters || !strictToolArgumentsMatch(metadata.parameters, argumentsValue)) throw new Error("Arguments tool call provider melanggar schema strict.");
    }
    output.push({
      id: `fc_${input.requestId}_${index}`,
      type: "function_call",
      call_id: toolCall.id,
      ...(metadata.namespace ? { namespace: metadata.namespace } : {}),
      name: metadata.name,
      arguments: toolCall.function.arguments,
      status: "completed",
    });
  }
  if (output.length === 0) throw new Error("Respons provider tidak memiliki output.");
  return {
    id: `resp_${input.requestId}`,
    object: "response",
    created_at: input.chatResponse.created,
    status: "completed",
    model: input.publicModel ?? input.chatResponse.model,
    output,
    usage: {
      input_tokens: input.chatResponse.usage.prompt_tokens,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: input.chatResponse.usage.completion_tokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: input.chatResponse.usage.total_tokens,
    },
  };
}

function sseEvent(type: string, payload: Record<string, unknown>, sequenceNumber: number) {
  return `event: ${type}\ndata: ${JSON.stringify({ ...payload, sequence_number: sequenceNumber })}\n\n`;
}

function* responseSseEvents(response: AiApiResponseObject) {
  let sequenceNumber = 0;
  const event = (type: string, payload: Record<string, unknown>) => sseEvent(type, payload, sequenceNumber++);
  yield event("response.created", { type: "response.created", response: { ...response, status: "in_progress", output: [] } });
  for (const [outputIndex, item] of response.output.entries()) {
    if (item.type === "message") {
      yield event("response.output_item.added", { type: "response.output_item.added", output_index: outputIndex, item: { ...item, status: "in_progress", content: [] } });
      const text = item.content.map((part) => part.text).join("");
      const completedPart = { type: "output_text" as const, text, annotations: [], logprobs: [] };
      yield event("response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: outputIndex, content_index: 0, part: { ...completedPart, text: "" } });
      if (text) yield event("response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: outputIndex, content_index: 0, delta: text, logprobs: [] });
      yield event("response.output_text.done", { type: "response.output_text.done", item_id: item.id, output_index: outputIndex, content_index: 0, text, logprobs: [] });
      yield event("response.content_part.done", { type: "response.content_part.done", item_id: item.id, output_index: outputIndex, content_index: 0, part: completedPart });
    } else {
      yield event("response.output_item.added", { type: "response.output_item.added", output_index: outputIndex, item: { ...item, status: "in_progress", arguments: "" } });
      if (item.arguments) yield event("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: item.id, output_index: outputIndex, delta: item.arguments });
      yield event("response.function_call_arguments.done", { type: "response.function_call_arguments.done", item_id: item.id, output_index: outputIndex, arguments: item.arguments });
    }
    yield event("response.output_item.done", { type: "response.output_item.done", output_index: outputIndex, item });
  }
  yield event("response.completed", { type: "response.completed", response });
  yield "data: [DONE]\n\n";
}

export function responseToSse(response: AiApiResponseObject) {
  return Array.from(responseSseEvents(response)).join("");
}

export function responseToSseStream(response: AiApiResponseObject) {
  const encoder = new TextEncoder();
  const events = responseSseEvents(response);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = events.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });
}
