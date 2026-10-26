import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bearerApiKey: vi.fn(() => "rz_live_test"),
  authenticateAiApiKey: vi.fn(async () => ({ id: "key_1", walletId: "wallet_1", dailySpendLimitMicros: 1_000_000n, rateLimitPerMinute: 10, concurrencyLimit: 2 })),
  acquireAiApiIngressAdmission: vi.fn(async () => ({ id: "ingress_1", expiresAt: new Date() })),
  releaseAiApiIngressAdmission: vi.fn(async () => undefined),
  executeAiApiChat: vi.fn(),
}));

vi.mock("@/lib/ai-api/service", () => {
  class AiApiError extends Error {
    code: string;
    httpStatus: number;
    requestId?: string;
    constructor(code: string, message: string, httpStatus: number, detail: { requestId?: string } = {}) {
      super(message);
      this.code = code;
      this.httpStatus = httpStatus;
      this.requestId = detail.requestId;
    }
  }
  return { AiApiError, ...mocks };
});

import { POST } from "@/app/v1/responses/route";

const responsesResponse = {
  id: "resp_req_123",
  object: "response" as const,
  created_at: 1_792_000_000,
  status: "completed" as const,
  model: "minimax/minimax-m3",
  output: [{ id: "msg_req_123", type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text" as const, text: "CAPTURED", annotations: [] }] }],
  usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 },
};

function request(stream: boolean, headers: Record<string, string> = {}) {
  return new Request("https://api.riezz99.biz.id/v1/responses", {
    method: "POST",
    headers: { Authorization: "Bearer hidden", "Content-Type": "application/json", "Idempotency-Key": "client-request-123", ...headers },
    body: JSON.stringify({
      model: "minimax/minimax-m3",
      stream,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Reply CAPTURED" }] }],
    }),
  });
}

describe("POST /v1/responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeAiApiChat.mockResolvedValue({ requestId: "req_123", chargeMicros: 42n, response: responsesResponse, replayed: false });
  });

  it("returns a non-streaming Responses object through endpoint-scoped billing", async () => {
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_123");
    expect(response.headers.get("x-riezz99-charge-micros")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({ object: "response", status: "completed", output: [{ type: "message" }] });
    expect(mocks.executeAiApiChat).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "responses",
      ingressLeaseId: "ingress_1",
      fingerprintSource: expect.objectContaining({ model: "minimax/minimax-m3", stream: false }),
      inputTokenUpperBound: expect.any(BigInt),
      idempotencyKey: "client-request-123",
      replayCompletedResponse: true,
      responseAdapter: expect.any(Function),
    }));
    expect(mocks.releaseAiApiIngressAdmission).not.toHaveBeenCalled();
  });

  it("returns Codex-compatible SSE after the same settled execution", async () => {
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: response.created");
    expect(body).toContain("event: response.output_text.delta");
    expect(body).toContain("event: response.completed");
    expect(body).toContain("data: [DONE]");
  });

  it("derives retry identity from Codex turn metadata when the explicit header is absent", async () => {
    const response = await POST(request(false, {
      "Idempotency-Key": "",
      "x-codex-turn-metadata": JSON.stringify({ turn_id: "01a14fd3-2c14-70d3-a91b-e2f63f57c70b" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.executeAiApiChat).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^codex:[A-Za-z0-9-]{16,80}:[a-f0-9]{64}$/),
    }));
  });

  it("rejects generic headerless requests before dispatch", async () => {
    const response = await POST(request(false, { "Idempotency-Key": "" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
    expect(mocks.executeAiApiChat).not.toHaveBeenCalled();
  });

  it("releases an untransferred ingress lease after a completed response replay", async () => {
    mocks.executeAiApiChat.mockResolvedValue({ requestId: "req_123", chargeMicros: 42n, response: responsesResponse, replayed: true });
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(mocks.releaseAiApiIngressAdmission).toHaveBeenCalledWith("ingress_1");
  });

  it("fails unsupported multimodal input before dispatch and releases ingress admission", async () => {
    const invalid = new Request("https://api.riezz99.biz.id/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer hidden", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "minimax/minimax-m3",
        input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }],
      }),
    });
    const response = await POST(invalid);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
    expect(mocks.executeAiApiChat).not.toHaveBeenCalled();
    expect(mocks.releaseAiApiIngressAdmission).toHaveBeenCalledWith("ingress_1");
  });
});
