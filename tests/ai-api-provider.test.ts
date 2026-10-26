import { afterEach, describe, expect, it, vi } from "vitest";
import { SekaiChatProvider, SekaiChatProviderError, SEKAI_CHAT_URL } from "@/lib/ai-api/providers/sekai-chat";

const request = {
  requestId: "req-local-1",
  idempotencyKey: "idem-upstream-1",
  model: "minimax/minimax-m3",
  messages: [{ role: "user" as const, content: "private prompt" }],
  maxCompletionTokens: 64,
};
const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("SEKAI non-streaming chat adapter", () => {
  it("uses the fixed endpoint, server credential, stable idempotency key, and bounded body", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const fetcher = vi.fn().mockResolvedValue(ok({
      id: "chatcmpl-safe",
      model: request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Halo" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }));
    const result = await new SekaiChatProvider({ fetch: fetcher }).complete(request);
    expect(fetcher).toHaveBeenCalledWith(SEKAI_CHAT_URL, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer server-only-secret", "Idempotency-Key": request.idempotencyKey }),
    }));
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: request.model, messages: request.messages, max_tokens: 64, stream: false });
    expect(result).toMatchObject({ promptTokens: 5n, completionTokens: 2n, providerRequestId: "chatcmpl-safe", response: { id: "chatcmpl-safe" } });
  });

  it("rejects a successful response when neither header nor body provides provider identity", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const error = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Halo" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })) }).complete(request).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SekaiChatProviderError);
    expect(error).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });
  });

  it("does not invent a cap for a direct adapter call without an effective limit", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const fetcher = vi.fn().mockResolvedValue(ok({
      id: "chatcmpl-default",
      model: request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Halo" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }));
    await new SekaiChatProvider({ fetch: fetcher }).complete({ ...request, maxCompletionTokens: undefined });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("forwards function tools and preserves validated tool calls with authoritative usage", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const toolRequest = {
      ...request,
      tools: [{ type: "function" as const, function: { name: "exec_command", description: "Run", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"], additionalProperties: false }, strict: false } }],
      toolChoice: "auto" as const,
      parallelToolCalls: true,
    };
    const fetcher = vi.fn().mockResolvedValue(ok({
      id: "chatcmpl-tool",
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "call_1", type: "function", function: { name: "exec_command", arguments: "{\"cmd\":\"pwd\"}" } },
      ] } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }));

    const result = await new SekaiChatProvider({ fetch: fetcher }).complete(toolRequest);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ tools: toolRequest.tools, tool_choice: "auto", parallel_tool_calls: true });
    expect(result.response.choices[0].message).toEqual({ role: "assistant", content: null, tool_calls: [
      { id: "call_1", type: "function", function: { name: "exec_command", arguments: "{\"cmd\":\"pwd\"}" } },
    ] });
  });

  it("rejects provider tool arguments that violate a strict JSON Schema", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const strictRequest = {
      ...request,
      tools: [{ type: "function" as const, function: {
        name: "exec_command",
        parameters: {
          type: "object",
          properties: { cmd: { type: "string" } },
          required: ["cmd"],
          additionalProperties: false,
        },
        strict: true,
      } }],
    };
    const error = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      id: "chatcmpl-invalid-strict-tool",
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "call_1", type: "function", function: { name: "exec_command", arguments: "{\"cmd\":123,\"extra\":true}" } },
      ] } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    })) }).complete(strictRequest).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SekaiChatProviderError);
    expect(error).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false, providerRequestId: "chatcmpl-invalid-strict-tool" });
  });

  it("rejects successful responses without authoritative usage", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const error = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({ id: "chatcmpl-no-usage", model: request.model, choices: [{ index: 0, message: { role: "assistant", content: "Halo" } }] })) }).complete(request).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SekaiChatProviderError);
    expect(error).toMatchObject({ category: "USAGE_MISSING", definitelyUnbilled: false });
  });

  it("does not leak prompt or credentials and treats post-dispatch 4xx as financially ambiguous", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const error = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "private prompt server-only-secret" } }), { status: 400 })) }).complete(request).catch((value: unknown) => value);
    expect(error).toMatchObject({ category: "INVALID_REQUEST", definitelyUnbilled: false });
    expect(JSON.stringify(error)).not.toMatch(/private prompt|server-only-secret/);
  });

  it.each([408, 409, 413, 451])("keeps HTTP %s financially ambiguous without opening the global breaker", async (status) => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const error = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(new Response("rejected", { status })) }).complete(request).catch((value: unknown) => value);
    expect(error).toMatchObject({ definitelyUnbilled: false, openBreaker: false, status });
  });

  it("rejects missing model echoes, multiple choices, and unknown tool calls before settlement", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const missingModel = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Halo" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete(request).catch((value: unknown) => value);
    expect(missingModel).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });

    const multipleChoices = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [
        { index: 0, finish_reason: "stop", message: { role: "assistant", content: "One" } },
        { index: 1, finish_reason: "stop", message: { role: "assistant", content: "Two" } },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 4 },
    })) }).complete(request).catch((value: unknown) => value);
    expect(multipleChoices).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });

    const toolRequest = {
      ...request,
      tools: [{ type: "function" as const, function: { name: "exec_command", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    };
    const unknownTool = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
        { id: "call_1", type: "function", function: { name: "not_allowed", arguments: "{}" } },
      ] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete(toolRequest).catch((value: unknown) => value);
    expect(unknownTool).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });
  });

  it("rejects truncated or inconsistent provider finish reasons", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const truncated = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: "partial" } }],
      usage: { prompt_tokens: 5, completion_tokens: 64 },
    })) }).complete(request).catch((value: unknown) => value);
    expect(truncated).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });

    const inconsistent = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "No tool" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete(request).catch((value: unknown) => value);
    expect(inconsistent).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });
  });

  it("enforces tool choice, parallel-call policy, and unique call IDs on provider output", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const tools = [{ type: "function" as const, function: { name: "exec_command", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
    const toolCall = { id: "call_1", type: "function", function: { name: "exec_command", arguments: "{}" } };

    const forbidden = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [toolCall] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete({ ...request, tools, toolChoice: "none" }).catch((value: unknown) => value);
    expect(forbidden).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });

    const missing = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "No call" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete({ ...request, tools, toolChoice: "required" }).catch((value: unknown) => value);
    expect(missing).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });

    const parallel = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [toolCall, { ...toolCall, id: "call_2" }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete({ ...request, tools, toolChoice: "auto", parallelToolCalls: false }).catch((value: unknown) => value);
    expect(parallel).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });

    const duplicate = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(ok({
      model: request.model,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [toolCall, toolCall] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })) }).complete({ ...request, tools, toolChoice: "auto", parallelToolCalls: true }).catch((value: unknown) => value);
    expect(duplicate).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });
  });

  it("fails closed on oversized and malformed responses", async () => {
    vi.stubEnv("SEKAI_API_KEY", "server-only-secret");
    const oversized = new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "99999999" } });
    const largeError = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(oversized) }).complete(request).catch((value: unknown) => value);
    expect(largeError).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });
    const malformed = await new SekaiChatProvider({ fetch: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })) }).complete(request).catch((value: unknown) => value);
    expect(malformed).toMatchObject({ category: "INVALID_RESPONSE", definitelyUnbilled: false });
  });
});
