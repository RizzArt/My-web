import { NextResponse } from "next/server";
import { stagingSecurityDiagnosticSnapshot, stagingSecurityDiagnosticsEnabled } from "@/lib/staging-security-diagnostics";

export const runtime = "nodejs";

function unavailable() {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export function GET(request: Request) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";
  if (!stagingSecurityDiagnosticsEnabled(hostname)) return unavailable();
  const snapshot = stagingSecurityDiagnosticSnapshot(request);
  return NextResponse.json(snapshot, {
    status: snapshot.trustedIdentityAccepted ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
