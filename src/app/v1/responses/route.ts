import { NextResponse } from "next/server";
import { readRequestTextWithLimit } from "@/lib/ai-api/http";
import { parseResponsesRequest, responseFromChatCompletion, responsesIdempotencyKey, responseToSseStream, type AiApiResponseObject } from "@/lib/ai-api/responses";
import { acquireAiApiIngressAdmission, AiApiError, authenticateAiApiKey, bearerApiKey, executeAiApiChat, releaseAiApiIngressAdmission } from "@/lib/ai-api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 1024 * 1024;

function errorResponse(error: unknown) {
  const known = error instanceof AiApiError;
  const code = known ? error.code : "internal_error";
  const status = known ? error.httpStatus : 500;
  const message = known ? error.message : "Terjadi kesalahan internal.";
  return NextResponse.json(
    { error: { message, type: status === 401 ? "authentication_error" : "invalid_request_error", code }, ...(known && error.requestId ? { request_id: error.requestId } : {}) },
    { status, headers: { "Cache-Control": "no-store", ...(known && error.requestId ? { "x-request-id": error.requestId } : {}) } },
  );
}

export async function POST(request: Request) {
  let ingressLeaseId: string | undefined;
  try {
    const plaintextKey = bearerApiKey(request);
    const authenticatedKey = await authenticateAiApiKey(plaintextKey);
    const ingress = await acquireAiApiIngressAdmission(authenticatedKey);
    ingressLeaseId = ingress.id;
    const text = await readRequestTextWithLimit(request, MAX_BODY_BYTES);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new AiApiError("invalid_json", "JSON tidak valid.", 400); }
    let parsed: ReturnType<typeof parseResponsesRequest>;
    let idempotencyKey: string;
    try {
      parsed = parseResponsesRequest(raw);
      idempotencyKey = responsesIdempotencyKey(request.headers.get("idempotency-key"), raw, request.headers.get("x-codex-turn-metadata"));
    } catch (error) {
      throw new AiApiError("invalid_request", error instanceof Error ? error.message : "Request tidak valid.", 400);
    }
    const result = await executeAiApiChat<AiApiResponseObject>({
      auth: authenticatedKey,
      request: parsed.chatRequest,
      endpoint: "responses",
      idempotencyKey,
      ingressLeaseId,
      fingerprintSource: raw,
      inputTokenUpperBound: parsed.inputTokenUpperBound,
      replayCompletedResponse: true,
      responseAdapter: ({ requestId, chatResponse }) => responseFromChatCompletion({
        requestId,
        aliases: parsed.toolAliases,
        chatResponse,
        publicModel: parsed.chatRequest.model,
      }),
    });
    if (!result.replayed) ingressLeaseId = undefined;
    const response = result.response;
    const commonHeaders = {
      "Cache-Control": "no-store",
      "x-request-id": result.requestId,
      "x-riezz99-charge-micros": result.chargeMicros.toString(),
    };
    if (!parsed.stream) return NextResponse.json(response, { status: 200, headers: commonHeaders });
    return new Response(responseToSseStream(response), {
      status: 200,
      headers: {
        ...commonHeaders,
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (ingressLeaseId) await releaseAiApiIngressAdmission(ingressLeaseId).catch(() => undefined);
  }
}
