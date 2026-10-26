import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { subscribeUser } from "@/lib/realtime/event-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function frame(event: string, data: unknown, id?: string) {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let cleanup = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* The client already closed the stream. */ }
      };
      const send = (event: string, data: unknown, id?: string) => { try { controller.enqueue(encoder.encode(frame(event, data, id))); } catch { cleanup(); } };
      send("ready", { connectedAt: new Date().toISOString() });
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      unsubscribe = subscribeUser(userId, (event) => {
        void prisma.user.findUnique({
          where: { id: userId }, select: { isActive: true },
        }).then((user) => {
          if (!user?.isActive) { cleanup(); return; }
          if (!closed) send(event.type, event, event.id);
        }).catch(() => cleanup());
      });
      heartbeat = setInterval(() => {
        void prisma.user.findUnique({
          where: { id: userId }, select: { isActive: true },
        }).then((user) => {
          if (!user?.isActive) { cleanup(); return; }
          if (!closed) send("ping", {});
        }).catch(() => cleanup());
      }, 22000);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
