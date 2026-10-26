import { NextResponse } from "next/server";
import {
  diagnosticClientKey,
  FixedWindowRateLimiter,
  hasOversizedDeclaredBody,
  PayloadTooLargeError,
  readBodyWithLimit,
  SOCIABUZZ_DIAGNOSTIC_RATE_LIMIT,
  SOCIABUZZ_DIAGNOSTIC_RATE_WINDOW_MS,
  safeSociaBuzzDiagnosticContentType,
  summarizeSociaBuzzDiagnosticPayload,
  summarizeSociaBuzzDiagnosticTopLevelKeys,
  verifySociaBuzzDiagnosticToken,
} from "@/lib/webhooks/sociabuzz-diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimiter = new FixedWindowRateLimiter(
  SOCIABUZZ_DIAGNOSTIC_RATE_LIMIT,
  SOCIABUZZ_DIAGNOSTIC_RATE_WINDOW_MS,
);
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const rateLimit = rateLimiter.allow(diagnosticClientKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan." },
      { status: 429, headers: { ...headers, "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  if (hasOversizedDeclaredBody(request.headers.get("content-length"))) {
    return NextResponse.json({ error: "Payload terlalu besar." }, { status: 413, headers });
  }

  try {
    const body = await readBodyWithLimit(request);
    // Deliberately logs only the sanitized shape; it never invokes payment processing.
    // Serialize explicitly so production logs retain the sanitized nested payload.
    const contentType = request.headers.get("content-type");
    const token = verifySociaBuzzDiagnosticToken(body, contentType);
    console.info("SociaBuzz diagnostic webhook received", JSON.stringify({
      received_at: new Date().toISOString(),
      method: request.method,
      pathname: new URL(request.url).pathname,
      content_type: safeSociaBuzzDiagnosticContentType(contentType),
      response_status: 200,
      ...summarizeSociaBuzzDiagnosticPayload(body, contentType),
      top_level_keys: summarizeSociaBuzzDiagnosticTopLevelKeys(body, contentType),
      token_present: token.tokenPresent,
      token_match: token.tokenMatch,
    }));
    return NextResponse.json({ received: true }, { headers });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "Payload terlalu besar." }, { status: 413, headers });
    }
    return NextResponse.json({ error: "Payload tidak dapat dibaca." }, { status: 400, headers });
  }
}
