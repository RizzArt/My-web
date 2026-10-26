export type ClientMessage = { id: string; createdAt: string; readAt?: string | null };
export type ClientRealtimeEvent = {
  id?: string;
  type: "notification" | "message" | "read-receipt" | "unread-count";
  title?: string;
  body?: string;
  href?: string;
  dedupeKey?: string;
  conversationId?: string;
  messageIds?: string[];
  readAt?: string;
};

export function mergeMessages<T extends ClientMessage>(current: T[], incoming: T[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => {
    const currentMessage = byId.get(message.id);
    // A late GET response must not erase a receipt already received over SSE.
    byId.set(message.id, currentMessage?.readAt && !message.readAt ? { ...message, readAt: currentMessage.readAt } : message);
  });
  return [...byId.values()].sort((a, b) => {
    const createdAt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return createdAt || a.id.localeCompare(b.id);
  });
}

export function reconcileOptimisticMessage<T extends ClientMessage>(current: T[], optimisticId: string, serverMessage: T) {
  return mergeMessages(current.filter((message) => message.id !== optimisticId), [serverMessage]);
}

export function applyReadReceipt<T extends ClientMessage>(messages: T[], receipt: Pick<ClientRealtimeEvent, "messageIds" | "readAt">) {
  if (!receipt.readAt || !receipt.messageIds?.length) return messages;
  const ids = new Set(receipt.messageIds);
  let changed = false;
  const next = messages.map((message) => {
    if (!ids.has(message.id) || message.readAt) return message;
    changed = true;
    return { ...message, readAt: receipt.readAt };
  });
  return changed ? next : messages;
}

export function canRecordVisibleChatRead(documentVisible: boolean, windowFocused: boolean) {
  return documentVisible && windowFocused;
}

export function getVisibleUnreadMessageIds<T extends ClientMessage & { senderId: string; status?: "sending" | "failed" }>(messages: T[], visibleIds: Set<string>, viewerId: string) {
  return [...new Set(messages.filter((message) => visibleIds.has(message.id) && message.senderId !== viewerId && !message.readAt && !message.status).map((message) => message.id))];
}

export function acceptRealtimeEvent(event: ClientRealtimeEvent, seen: Set<string>) {
  const key = getRealtimeDedupeKey(event);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}

export function isActiveConversation(pathname: string, conversationId: string | undefined) {
  if (!conversationId) return false;
  const match = pathname.match(/^\/(?:seller\/|admin\/)?messages\/([^/]+)\/?$/);
  return Boolean(match && decodeURIComponent(match[1]) === conversationId);
}

export function shouldShowIncomingToast(event: ClientRealtimeEvent, pathname: string) {
  if (event.type === "unread-count" || event.type === "read-receipt") return false;
  return !isActiveConversation(pathname, event.conversationId);
}

export function getRealtimeDedupeKey(event: ClientRealtimeEvent) {
  const explicit = event.dedupeKey?.trim();
  if (explicit) return explicit;
  const id = event.id?.trim();
  return id ? `${event.type}:${id}` : undefined;
}

export function parseRealtimeEvent(data: string): ClientRealtimeEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const event = parsed as Partial<ClientRealtimeEvent>;
    if (event.type !== "message" && event.type !== "notification" && event.type !== "read-receipt" && event.type !== "unread-count") return null;
    return event as ClientRealtimeEvent;
  } catch {
    return null;
  }
}
