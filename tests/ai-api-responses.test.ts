import { describe, expect, it } from "vitest";
import { parseResponsesRequest, responseFromChatCompletion, responsesIdempotencyKey, responseToSse } from "@/lib/ai-api/responses";

describe("AI API Responses adapter", () => {
  it("parses the current Codex request shape into one safe chat request", () => {
    const parsed = parseResponsesRequest({
      model: "minimax/minimax-m3",
      instructions: "You are a coding agent.",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "Follow repository instructions." }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd." }] },
      ],
      tools: [
        { type: "function", name: "exec_command", description: "Run a command", strict: false, parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"], additionalProperties: false } },
        { type: "namespace", name: "multi_agent_v1", description: "Agent tools", tools: [
          { type: "function", name: "spawn_agent", description: "Spawn", strict: false, parameters: { type: "object", properties: {}, additionalProperties: false } },
        ] },
      ],
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: { summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "session-1",
    });

    expect(parsed.stream).toBe(true);
    expect(parsed.chatRequest.model).toBe("minimax/minimax-m3");
    expect(parsed.chatRequest.maxCompletionTokens).toBe(8_192);
    expect(parsed.chatRequest.messages).toEqual([
      { role: "system", content: "You are a coding agent." },
      { role: "developer", content: "Follow repository instructions." },
      { role: "user", content: "Run pwd." },
    ]);
    expect(parsed.chatRequest.tools?.map((tool) => tool.function.name)).toEqual([
      "exec_command",
      "multi_agent_v1__spawn_agent",
    ]);
    expect(parsed.toolAliases.get("multi_agent_v1__spawn_agent")).toEqual({
      namespace: "multi_agent_v1",
      name: "spawn_agent",
      kind: "function",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      strict: false,
    });
    expect(parsed.inputTokenUpperBound).toBeGreaterThan(8_192n);
  });

  it("translates Codex function-call history and tool output into chat messages", () => {
    const parsed = parseResponsesRequest({
      model: "minimax/minimax-m3",
      stream: true,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd." }] },
        { type: "function_call", id: "fc_1", call_id: "call_1", namespace: "multi_agent_v1", name: "spawn_agent", arguments: "{\"message\":\"inspect\"}" },
        { type: "function_call_output", id: "fco_1", call_id: "call_1", output: "agent started" },
      ],
      tools: [{ type: "namespace", name: "multi_agent_v1", description: "Agent tools", tools: [
        { type: "function", name: "spawn_agent", description: "Spawn", strict: false, parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } },
      ] }],
    });

    expect(parsed.chatRequest.messages).toEqual([
      { role: "user", content: "Run pwd." },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "multi_agent_v1__spawn_agent", arguments: "{\"message\":\"inspect\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "agent started" },
    ]);
  });

  it("accepts consecutive completed tool rounds in full Responses history", () => {
    const parsed = parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: [
        { type: "message", role: "user", content: "Inspect twice." },
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{\"cmd\":\"pwd\"}" },
        { type: "function_call_output", call_id: "call_1", output: "/srv/app" },
        { type: "function_call", call_id: "call_2", name: "exec_command", arguments: "{\"cmd\":\"whoami\"}" },
        { type: "function_call_output", call_id: "call_2", output: "ubuntu" },
      ],
      tools: [{ type: "function", name: "exec_command", strict: false, parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
        additionalProperties: false,
      } }],
    });

    expect(parsed.chatRequest.messages).toEqual([
      { role: "user", content: "Inspect twice." },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "exec_command", arguments: "{\"cmd\":\"pwd\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "/srv/app" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_2", type: "function", function: { name: "exec_command", arguments: "{\"cmd\":\"whoami\"}" } }] },
      { role: "tool", tool_call_id: "call_2", content: "ubuntu" },
    ]);
  });

  it("rejects strict tool arguments in supplied full history", () => {
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: [
        { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{\"cmd\":123,\"extra\":true}" },
        { type: "function_call_output", call_id: "call_1", output: "invalid" },
      ],
      tools: [{ type: "function", name: "exec_command", strict: true, parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
        additionalProperties: false,
      } }],
    })).toThrow("Arguments function call melanggar schema strict.");
  });

  it("rejects duplicate calls, duplicate outputs, and outputs before their calls", () => {
    const base = { model: "minimax/minimax-m3", tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] };
    expect(() => parseResponsesRequest({ ...base, input: [
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
    ] })).toThrow("call_id duplikat");
    expect(() => parseResponsesRequest({ ...base, input: [
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "first" },
      { type: "function_call_output", call_id: "call_1", output: "second" },
    ] })).toThrow("function_call_output tidak cocok");
    expect(() => parseResponsesRequest({ ...base, input: [
      { type: "function_call_output", call_id: "call_1", output: "early" },
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
    ] })).toThrow("function_call_output tidak cocok");
  });

  it("rejects incomplete or delayed tool outputs before a later message", () => {
    const base = { model: "minimax/minimax-m3", tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] };
    expect(() => parseResponsesRequest({ ...base, input: [
      { type: "message", role: "user", content: "start" },
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "message", role: "user", content: "skip the output" },
    ] })).toThrow("function_call_output wajib diselesaikan");
    expect(() => parseResponsesRequest({ ...base, input: [
      { type: "message", role: "user", content: "start" },
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "message", role: "user", content: "too early" },
      { type: "function_call_output", call_id: "call_1", output: "late" },
    ] })).toThrow("function_call_output wajib diselesaikan");
  });

  it("converts a settled text completion into Responses JSON and Codex-compatible SSE", () => {
    const response = responseFromChatCompletion({
      requestId: "req_123",
      aliases: new Map(),
      chatResponse: {
        id: "chatcmpl_upstream",
        object: "chat.completion",
        created: 1_792_000_000,
        model: "minimax/minimax-m3",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "CAPTURED" } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      },
    });

    expect(response).toMatchObject({
      id: "resp_req_123",
      object: "response",
      status: "completed",
      model: "minimax/minimax-m3",
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "CAPTURED", annotations: [] }] }],
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
    });
    const sse = responseToSse(response);
    const eventTypes = sse.split("\n").filter((line) => line.startsWith("event: ")).map((line) => line.slice(7));
    expect(eventTypes).toEqual([
      "response.created",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ]);
    const events = sse.split("\n\n").filter((chunk) => chunk.startsWith("event: ")).map((chunk) => JSON.parse(chunk.split("\ndata: ")[1]));
    expect(events.map((event) => event.sequence_number)).toEqual(events.map((_, index) => index));
    expect(events.find((event) => event.type === "response.content_part.added")?.part).toEqual({ type: "output_text", text: "", annotations: [], logprobs: [] });
    expect(events.find((event) => event.type === "response.output_text.delta")?.logprobs).toEqual([]);
    expect(sse).toContain("data: [DONE]");
  });

  it("restores namespaced function calls and emits function argument SSE events", () => {
    const response = responseFromChatCompletion({
      requestId: "req_tools",
      aliases: new Map([["multi_agent_v1__spawn_agent", { namespace: "multi_agent_v1", name: "spawn_agent", kind: "function" as const }]]),
      chatResponse: {
        id: "chatcmpl_tools",
        object: "chat.completion",
        created: 1_792_000_001,
        model: "minimax/minimax-m3",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
          { id: "call_1", type: "function", function: { name: "multi_agent_v1__spawn_agent", arguments: "{\"message\":\"inspect\"}" } },
        ] } }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      },
    });

    expect(response.output).toEqual([{
      id: "fc_req_tools_0",
      type: "function_call",
      call_id: "call_1",
      namespace: "multi_agent_v1",
      name: "spawn_agent",
      arguments: "{\"message\":\"inspect\"}",
      status: "completed",
    }]);
    const sse = responseToSse(response);
    const eventTypes = sse.split("\n").filter((line) => line.startsWith("event: ")).map((line) => line.slice(7));
    expect(eventTypes).toEqual([
      "response.created",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]);
    const events = sse.split("\n\n").filter((chunk) => chunk.startsWith("event: ")).map((chunk) => JSON.parse(chunk.split("\ndata: ")[1]));
    expect(events.map((event) => event.sequence_number)).toEqual(events.map((_, index) => index));
  });

  it("rejects strict tool arguments again when converting a provider response", () => {
    const parsed = parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Run a command.",
      tools: [{ type: "function", name: "exec_command", strict: true, parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
        additionalProperties: false,
      } }],
    });

    expect(() => responseFromChatCompletion({
      requestId: "req_invalid_strict",
      aliases: parsed.toolAliases,
      chatResponse: {
        id: "chatcmpl_invalid_strict",
        object: "chat.completion",
        created: 1_792_000_002,
        model: "minimax/minimax-m3",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
          { id: "call_1", type: "function", function: { name: "exec_command", arguments: "{\"cmd\":123,\"extra\":true}" } },
        ] } }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      },
    })).toThrow("Arguments tool call provider melanggar schema strict.");
  });

  it("derives stable retry identity from the current Codex turn metadata", () => {
    const metadata = JSON.stringify({ turn_id: "01a14fd3-2c14-70d3-a91b-e2f63f57c70b", request_kind: "turn" });
    const left = responsesIdempotencyKey(null, { model: "minimax/minimax-m3", input: [{ type: "message", role: "user", content: "hello" }] }, metadata);
    const reordered = responsesIdempotencyKey(undefined, { input: [{ content: "hello", role: "user", type: "message" }], model: "minimax/minimax-m3" }, metadata);
    const different = responsesIdempotencyKey(null, { model: "minimax/minimax-m3", input: [{ type: "message", role: "user", content: "different" }] }, metadata);
    const nextTurn = responsesIdempotencyKey(null, { model: "minimax/minimax-m3", input: [{ type: "message", role: "user", content: "hello" }] }, JSON.stringify({ turn_id: "01a14fd3-2c14-70d3-a91b-e2f63f57c71c" }));
    expect(left).toMatch(/^codex:[A-Za-z0-9-]{16,80}:[a-f0-9]{64}$/);
    expect(reordered).toBe(left);
    expect(different).not.toBe(left);
    expect(nextTurn).not.toBe(left);
    expect(responsesIdempotencyKey("client-key-123", {}, null)).toBe("client-key-123");
    expect(() => responsesIdempotencyKey(null, {}, null)).toThrow("Idempotency-Key wajib");
    expect(() => responsesIdempotencyKey(null, {}, "not-json")).toThrow("metadata Codex tidak valid");
  });

  it("rejects unsupported continuation and semantic controls instead of silently discarding them", () => {
    const base = { model: "minimax/minimax-m3", input: "Hello" };
    expect(() => parseResponsesRequest({ ...base, previous_response_id: "resp_old" })).toThrow("previous_response_id belum didukung.");
    expect(() => parseResponsesRequest({ ...base, text: { format: { type: "json_object" } } })).toThrow("text belum didukung.");
    expect(() => parseResponsesRequest({ ...base, service_tier: "priority" })).toThrow("service_tier belum didukung.");
    expect(() => parseResponsesRequest({ ...base, store: true })).toThrow("store=true belum didukung.");
    expect(() => parseResponsesRequest({ ...base, store: "false" })).toThrow("store tidak valid.");
    expect(() => parseResponsesRequest({ ...base, temperature: 0.2 })).toThrow("Field Responses API belum didukung: temperature.");
    expect(() => parseResponsesRequest({ ...base, bogus: true })).toThrow("Field Responses API belum didukung: bogus.");
  });

  it("accepts only the bounded compatibility hints sent by current Codex", () => {
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Hello",
      store: false,
      reasoning: { summary: "auto" },
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "01a14fd3-2b87-7a40-90ba-a665306d3ba6",
      client_metadata: { "x-codex-window-id": "window:0", thread_id: "thread-1" },
    })).not.toThrow();
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: "Hello", reasoning: { effort: "high" } })).toThrow("reasoning belum didukung.");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: "Hello", include: ["output_text.logprobs"] })).toThrow("include belum didukung.");
  });

  it("preserves supported request semantics instead of coercing or inventing provider controls", () => {
    const parsed = parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: "Keep this role." }] }],
      tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }],
    });
    expect(parsed.chatRequest.messages).toEqual([{ role: "developer", content: "Keep this role." }]);
    expect(parsed.chatRequest.toolChoice).toBeUndefined();
    expect(parsed.chatRequest.maxCompletionTokensExplicit).toBe(false);
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", instructions: "", input: "Hello" })).toThrow("Instructions tidak valid.");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: [{ type: "message", role: "assistant", content: [{ type: "input_text", text: "wrong direction" }] }] })).toThrow("Responses API saat ini hanya mendukung konten teks.");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: [{ type: "message", role: "user", content: [{ type: "output_text", text: "wrong direction" }] }] })).toThrow("Responses API saat ini hanya mendukung konten teks.");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: "Hello", parallel_tool_calls: false })).toThrow("parallel_tool_calls=false belum didukung.");
  });

  it("rejects unknown nested fields and non-completed nested statuses", () => {
    const baseTool = { type: "function", name: "lookup", parameters: { type: "object", properties: {} } };
    const base = { model: "minimax/minimax-m3", tools: [baseTool] };
    const invalidInputs = [
      [{ type: "message", role: "user", content: "hello", unknown: true }],
      [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello", unknown: true }] }],
      [{ type: "message", role: "user", content: "hello", status: "incomplete" }],
      [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}", unknown: true }],
      [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}", status: "in_progress" }],
      [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" }, { type: "function_call_output", call_id: "call_1", output: "ok", unknown: true }],
    ];
    for (const input of invalidInputs) expect(() => parseResponsesRequest({ ...base, input })).toThrow("Field nested Responses API belum didukung");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: "hello", tools: [{ ...baseTool, unknown: true }] })).toThrow("Field nested Responses API belum didukung");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: "hello", tools: [{ type: "namespace", name: "ns", tools: [baseTool], unknown: true }] })).toThrow("Field nested Responses API belum didukung");
    expect(() => parseResponsesRequest({ model: "minimax/minimax-m3", input: "hello", tools: [{ type: "namespace", name: "ns", tools: [{ ...baseTool, unknown: true }] }] })).toThrow("Field nested Responses API belum didukung");
  });

  it("rejects hosted web search instead of silently advertising an unavailable tool", () => {
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Search the web",
      tools: [{ type: "web_search", external_web_access: true }],
      tool_choice: "auto",
    })).toThrow("web_search belum didukung");
  });


  it("accepts OpenAI SDK shorthand string input", () => {
    const parsed = parseResponsesRequest({ model: "minimax/minimax-m3", input: "Hello" });
    expect(parsed.stream).toBe(false);
    expect(parsed.chatRequest.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("rejects invalid strict tool schemas before provider dispatch", () => {
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Hello",
      tools: [{ type: "function", name: "broken", strict: true, parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: "cmd",
      } }],
    })).toThrow("Schema tool strict tidak valid.");
  });

  it("rejects duplicate public tool identities before aliasing", () => {
    const schema = { type: "object", properties: {}, additionalProperties: false };
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Hello",
      tools: [
        { type: "function", name: "lookup", description: "First", parameters: schema },
        { type: "function", name: "lookup", description: "Second", parameters: schema },
      ],
    })).toThrow("Identitas tool duplikat.");
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Hello",
      tools: [
        { type: "namespace", name: "search", tools: [{ type: "function", name: "lookup", parameters: schema }] },
        { type: "namespace", name: "search", tools: [{ type: "function", name: "lookup", parameters: schema }] },
      ],
    })).toThrow("Identitas tool duplikat.");
  });

  it("bounds flattened namespace tools instead of only counting top-level entries", () => {
    const tools = (length: number) => [{ type: "namespace", name: "bulk", tools: Array.from({ length }, (_, index) => ({
      type: "function",
      name: `tool_${index}`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    })) }];
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Hello",
      tools: tools(200),
    })).not.toThrow();
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: "Hello",
      tools: tools(257),
    })).toThrow("Daftar tools tidak valid.");
  });

  it("accepts authenticated Codex histories above the old 64 KiB ceiling while keeping a hard bound", () => {
    const parsed = parseResponsesRequest({
      model: "minimax/minimax-m3",
      stream: true,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "x".repeat(100 * 1024) }] }],
    });
    expect(parsed.inputTokenUpperBound).toBeGreaterThan(100_000n);
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "x".repeat(900 * 1024) }] }],
    })).not.toThrow();
    expect(() => parseResponsesRequest({
      model: "minimax/minimax-m3",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "x".repeat(970 * 1024) }] }],
    })).toThrow("Payload terlalu besar.");
  });
});
