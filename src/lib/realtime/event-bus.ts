import { randomUUID } from "node:crypto";

export type RealtimeEvent = {
  id: string;
  type: "notification" | "message" | "read-receipt" | "unread-count";
  title?: string;
  body?: string;
  href?: string;
  createdAt: string;
  notificationId?: string;
  messageId?: string;
  messageIds?: string[];
  conversationId?: string;
  readAt?: string;
  dedupeKey: string;
};

type Listener = (event: RealtimeEvent) => void;
type RealtimeBusState = { listeners: Map<string, Set<Listener>> };

// Route handlers can be bundled separately; keep the bus on the process global
// so SSE subscriptions and publish calls always share the same listener map.
const globalForRealtime = globalThis as typeof globalThis & { __riezz99RealtimeBus?: RealtimeBusState };
const bus = globalForRealtime.__riezz99RealtimeBus ?? { listeners: new Map<string, Set<Listener>>() };
globalForRealtime.__riezz99RealtimeBus = bus;
const listeners = bus.listeners;

function diagnostics(message: string) {
  if (process.env.REALTIME_DIAGNOSTICS === "1") console.info(`[realtime] ${message}`);
}

export function publishToUser(userId: string, event: Omit<RealtimeEvent, "id" | "createdAt"> & Partial<Pick<RealtimeEvent, "id" | "createdAt">>) {
  const complete: RealtimeEvent = { ...event, id: event.id ?? randomUUID(), createdAt: event.createdAt ?? new Date().toISOString() };
  const userListeners = listeners.get(userId);
  diagnostics(`publish user=${userId} listeners=${userListeners?.size ?? 0} event=${complete.type}`);
  userListeners?.forEach((listener) => listener(complete));
  return complete;
}

export function subscribeUser(userId: string, listener: Listener) {
  let userListeners = listeners.get(userId);
  if (!userListeners) {
    userListeners = new Set();
    listeners.set(userId, userListeners);
  }
  userListeners.add(listener);
  diagnostics(`connect user=${userId}`);
  return () => {
    userListeners?.delete(listener);
    if (!userListeners?.size) listeners.delete(userId);
    diagnostics(`disconnect user=${userId}`);
  };
}

export function listenerCount(userId?: string) {
  return userId ? listeners.get(userId)?.size ?? 0 : [...listeners.values()].reduce((total, set) => total + set.size, 0);
}

// This is intentionally process-local for the current single Next.js instance.
// If the app becomes multi-instance, replace this transport with Redis/pub-sub
// without changing the publish/subscribe API consumed by the client.
