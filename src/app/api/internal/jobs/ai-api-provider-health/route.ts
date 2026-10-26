import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAiApiProviderHealthJob } from "@/lib/ai-api/provider-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidSecret(request: Request, expected: string) {
  const received = request.headers.get("x-cron-secret");
  if (!received) return false;
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const expected = process.env.AI_API_HEALTH_CRON_SECRET?.trim();
  if (!expected || !hasValidSecret(request, expected)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  try {
    const summary = await runAiApiProviderHealthJob();
    if (!summary.ok) {
      console.error("AI API provider health job degraded", { checked: summary.checked, renewed: summary.renewed, recovered: summary.recovered, opened: summary.opened, transientFailures: summary.transientFailures, reasonCode: summary.reasonCode ?? "unknown" });
      return NextResponse.json(summary, { status: 503 });
    }
    console.info("AI API provider health job", { checked: summary.checked, renewed: summary.renewed, recovered: summary.recovered, opened: summary.opened, skipped: summary.skipped });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("AI API provider health job failed", { error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: "AI API provider health job failed." }, { status: 500 });
  }
}
