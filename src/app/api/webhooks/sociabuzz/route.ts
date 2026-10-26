import {
  discardSociaBuzzWakeBody,
  touchSociaBuzzWakeMarker,
} from "@/lib/webhooks/sociabuzz-wake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export async function POST(request: Request) {
  // The payload is deliberately discarded: it is only an untrusted wake-up hint.
  const bodyResult = await discardSociaBuzzWakeBody(request);
  const wake = await touchSociaBuzzWakeMarker();
  const errorCategory = wake.errorCategory ?? (bodyResult === "ok" ? undefined : bodyResult);

  console.info("SociaBuzz webhook wake received", JSON.stringify({
    received_at: new Date().toISOString(),
    debounced: wake.debounced,
    wake_written: wake.wakeWritten,
    ...(errorCategory ? { error_category: errorCategory } : {}),
  }));

  return new Response('{"received":true}', { status: 200, headers });
}
