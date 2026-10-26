import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/security-rate-limit";
import { stagingSecurityDiagnosticSnapshot, stagingSecurityDiagnosticsEnabled } from "@/lib/staging-security-diagnostics";
import { trustedClientIp } from "@/lib/trusted-client-ip";

export const runtime = "nodejs";

const PROBE_LIMIT = 5;
const PROBE_WINDOW_MS = 15 * 60 * 1000;

function unavailable() {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  if (!stagingSecurityDiagnosticsEnabled(hostname)) return unavailable();

  const clientIp = trustedClientIp(request);
  const snapshot = stagingSecurityDiagnosticSnapshot(request);
  if (!clientIp) {
    return NextResponse.json({ ...snapshot, error: "Trusted proxy identity is missing." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const result = await consumeRateLimit({
    scope: "staging-security-probe-ip",
    identifier: clientIp,
    limit: PROBE_LIMIT,
    windowMs: PROBE_WINDOW_MS,
  });
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!result.allowed) headers.set("Retry-After", String(result.retryAfterSeconds));

  return NextResponse.json({
    ...snapshot,
    allowed: result.allowed,
    maxRequests: PROBE_LIMIT,
    windowSeconds: PROBE_WINDOW_MS / 1000,
    retryAfterSeconds: result.allowed ? null : result.retryAfterSeconds,
  }, { status: result.allowed ? 200 : 429, headers });
}
