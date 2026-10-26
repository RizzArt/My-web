import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { acceptDueManualDeliveries } from "@/lib/delivery/service";

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
  const expected = process.env.AUTO_ACCEPT_CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "Job secret is not configured." }, { status: 503 });
  if (!hasValidSecret(request, expected)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  try {
    const summary = await acceptDueManualDeliveries();
    console.info("Manual delivery auto-accept job", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("Manual delivery auto-accept job failed", { error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ ok: false, error: "Auto-accept job failed." }, { status: 500 });
  }
}
