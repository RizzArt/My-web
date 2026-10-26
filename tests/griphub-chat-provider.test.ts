import { afterEach, describe, expect, it, vi } from "vitest";
import { GriphubChatProvider, GRIPHUB_CHAT_URL } from "@/lib/ai-api/providers/griphub-chat";

const request = { requestId: "req-griphub-1", idempotencyKey: "idem-griphub-1", model: "minimax-m3", messages: [{ role: "user" as const, content: "private prompt" }], maxCompletionTokens: 128 };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllEnvs());

describe("Griphub non-streaming chat adapter", () => {
  it("uses the documented endpoint and GRIPHUB_API_KEY while preserving strict response evidence", async () => {
    vi.stubEnv("GRIPHUB_API_KEY", "griphub-server-only-secret");
    const fetcher = vi.fn().mockResolvedValue(response({
      id: "resp_safe_griphub_1",
      model: "minimax-m3",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }],
      usage: { prompt_tokens: 20, completion_tokens: 2 },
    }));

    const result = await new GriphubChatProvider({ fetch: fetcher }).complete(request);
    expect(fetcher).toHaveBeenCalledWith(GRIPHUB_CHAT_URL, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer griphub-server-only-secret", "Idempotency-Key": "idem-griphub-1" }) }));
    expect(result).toMatchObject({ providerRequestId: "resp_safe_griphub_1", promptTokens: 20n, completionTokens: 2n, response: { model: "minimax-m3" } });
  });
});
