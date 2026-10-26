import { NextResponse } from "next/server";
import { readRequestTextWithLimit } from "@/lib/ai-api/http";
import { acquireAiApiIngressAdmission, AiApiError, authenticateAiApiKey, bearerApiKey, executeAiApiChat, releaseAiApiIngressAdmission } from "@/lib/ai-api/service";
import { parseChatRequest } from "@/lib/ai-api/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 70 * 1024;

function errorResponse(error: unknown) {
  const known = error instanceof AiApiError;
  const code = known ? error.code : "internal_error";
  const status = known ? error.httpStatus : 500;
  const message = known ? error.message : "Terjadi kesalahan internal.";
  return NextResponse.json({ error: { message, type: status === 401 ? "authentication_error" : "invalid_request_error", code }, ...(known && error.requestId ? { request_id: error.requestId } : {}) }, { status, headers: known && error.requestId ? { "x-request-id": error.requestId } : undefined });
}

export async function POST(request: Request) {
  let ingressLeaseId: string | undefined;
  try {
    const plaintextKey = bearerApiKey(request);
    const authenticatedKey = await authenticateAiApiKey(plaintextKey);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new AiApiError("idempotency_key_required", "Header Idempotency-Key wajib diisi.", 400);
    const ingress = await acquireAiApiIngressAdmission(authenticatedKey);
    ingressLeaseId = ingress.id;
    const text = await readRequestTextWithLimit(request, MAX_BODY_BYTES);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new AiApiError("invalid_json", "JSON tidak valid.", 400); }
    if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { stream?: unknown }).stream === true) throw new AiApiError("streaming_not_supported", "Mode stream belum didukung.", 400);
    let parsed: ReturnType<typeof parseChatRequest>;
    try { parsed = parseChatRequest(raw); }
    catch (error) { throw new AiApiError("invalid_request", error instanceof Error ? error.message : "Request tidak valid.", 400); }
    const result = await executeAiApiChat({ auth: authenticatedKey, request: parsed, idempotencyKey, ingressLeaseId });
    ingressLeaseId = undefined;
    return NextResponse.json(result.response, { status: 200, headers: { "x-request-id": result.requestId, "x-riezz99-charge-micros": result.chargeMicros.toString() } });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (ingressLeaseId) await releaseAiApiIngressAdmission(ingressLeaseId).catch(() => undefined);
  }
}
