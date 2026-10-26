"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyReadReceipt, canRecordVisibleChatRead, getVisibleUnreadMessageIds, mergeMessages, reconcileOptimisticMessage } from "@/lib/realtime/client-state";

type Attachment = { id: string; kind: "IMAGE" | "VIDEO"; mimeType: string; byteSize: number; previewUrl?: string };
type Message = { id: string; senderId: string; content: string; createdAt: string; readAt?: string | null; sender?: { name: string | null; role: string }; attachments?: Attachment[]; status?: "sending" | "failed" };
type SelectedImage = { source: string; downloadUrl: string };
type DraftAttachment = Attachment & { file: File; status: "pending" | "uploading" | "uploaded" | "error"; progress: number; error?: string };
type RealtimeMessage = { conversationId?: string; messageIds?: string[]; readAt?: string };
type ToastRequest = { title: string; body?: string; type?: "info" | "success" | "warning" | "error" | "message" };

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"]);
const maxFiles = 4;
const maxImageBytes = 10 * 1024 * 1024;
const maxVideoBytes = 50 * 1024 * 1024;

function formatBytes(value: number) { return `${(value / (1024 * 1024)).toFixed(value >= 1024 * 1024 ? 1 : 2).replace(/\.0$/, "")} MB`; }
function mediaLabel(attachment: { kind: "IMAGE" | "VIDEO"; mimeType: string }) { return `${attachment.kind === "IMAGE" ? "Gambar" : "Video"} · ${attachment.mimeType.split("/")[1]?.toUpperCase() ?? "format"}`; }
const jakartaTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const jakartaDate = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const jakartaDateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
function formatMessageTime(value: string) { return jakartaTime.format(new Date(value)); }
function formatMessageDate(value: string) { return jakartaDate.format(new Date(value)); }
function messageDayKey(value: string) { return jakartaDateKey.format(new Date(value)); }
function mediaUrl(conversationId: string, attachmentId: string) { return `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}/media`; }
function downloadUrl(conversationId: string, attachmentId: string) { return `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}/download`; }
function openAttachmentDownload(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}

function AttachmentDownloadButton({ url, label = "Unduh" }: { url: string; label?: string }) {
  return <button type="button" onClick={() => openAttachmentDownload(url)} className="min-h-11 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-sand focus:outline-none focus:ring-2 focus:ring-coral/50">{label}</button>;
}

function uploadAttachment(conversationId: string, draft: DraftAttachment, onProgress: (progress: number) => void) {
  return new Promise<Attachment>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/conversations/${encodeURIComponent(conversationId)}/attachments`);
    request.timeout = 180000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onerror = () => reject(new Error("Upload gagal karena koneksi terputus."));
    request.ontimeout = () => reject(new Error("Upload terlalu lama. Coba lagi dengan koneksi yang lebih stabil."));
    request.onload = () => {
      let data: { attachment?: Attachment; error?: string } = {};
      try { data = JSON.parse(request.responseText) as typeof data; } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300 && data.attachment) resolve(data.attachment);
      else reject(new Error(data.error ?? "Lampiran gagal diunggah."));
    };
    const form = new FormData();
    form.append("file", draft.file);
    request.send(form);
  });
}

export function ConversationPage({ conversationId, viewerId, basePath = "/messages" }: { conversationId: string; viewerId: string; basePath?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const historyClearedAtRef = useRef<string | null>(null);
  const shouldStickRef = useRef(true);
  const mountedRef = useRef(true);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const messageNodesRef = useRef(new Map<string, HTMLDivElement>());
  const visibleMessageIdsRef = useRef(new Set<string>());
  const readRequestedIdsRef = useRef(new Set<string>());
  const readInFlightIdsRef = useRef(new Set<string>());
  const readTimerRef = useRef<number | undefined>(undefined);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const scrollToBottom = useCallback(() => { const list = listRef.current; if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" }); setNewMessageCount(0); }, []);
  const loadMessages = useCallback(async (incremental = false) => {
    const serverMessages = messagesRef.current.filter((message) => message.status !== "sending" && message.status !== "failed");
    const last = serverMessages[serverMessages.length - 1];
    const query = incremental && last ? `?afterCreatedAt=${encodeURIComponent(last.createdAt)}&afterId=${encodeURIComponent(last.id)}` : "";
    const response = await fetch(`/api/conversations/${conversationId}/messages${query}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Chat tidak dapat dibuka.");
    if (mountedRef.current) {
      const cutoff = data.historyClearedAt ?? null;
      const historyChanged = historyClearedAtRef.current !== cutoff;
      historyClearedAtRef.current = cutoff;
      const keepLocal = historyChanged ? [] : incremental
        ? messagesRef.current
        : messagesRef.current.filter((message) => message.status === "sending" || message.status === "failed");
      const merged = mergeMessages(keepLocal, data.messages ?? []);
      setMessages(merged);
      messagesRef.current = merged;
    }
  }, [conversationId]);
  const syncMessages = useCallback(async (incremental = true) => {
    if (syncInFlightRef.current) { syncQueuedRef.current = true; return; }
    syncInFlightRef.current = true;
    try {
      await loadMessages(incremental);
      if (incremental && shouldStickRef.current) scrollToBottom();
    } catch (loadError: unknown) {
      if (!incremental && mountedRef.current) setError(loadError instanceof Error ? loadError.message : "Chat tidak dapat dibuka.");
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current && mountedRef.current) { syncQueuedRef.current = false; void syncMessages(true); }
    }
  }, [loadMessages, scrollToBottom]);
  const flushVisibleReads = useCallback(async () => {
    if (!canRecordVisibleChatRead(document.visibilityState === "visible", document.hasFocus())) return;
    const eligible = getVisibleUnreadMessageIds(messagesRef.current, visibleMessageIdsRef.current, viewerId);
    const messageIds = eligible.filter((id) => !readRequestedIdsRef.current.has(id) && !readInFlightIdsRef.current.has(id)).slice(0, 100);
    if (!messageIds.length) return;
    messageIds.forEach((id) => readInFlightIdsRef.current.add(id));
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds }),
      });
      if (!response.ok) return;
      messageIds.forEach((id) => readRequestedIdsRef.current.add(id));
    } finally {
      messageIds.forEach((id) => readInFlightIdsRef.current.delete(id));
    }
  }, [conversationId, viewerId]);
  const scheduleVisibleReads = useCallback(() => {
    if (!canRecordVisibleChatRead(document.visibilityState === "visible", document.hasFocus())) return;
    if (readTimerRef.current !== undefined) window.clearTimeout(readTimerRef.current);
    readTimerRef.current = window.setTimeout(() => {
      readTimerRef.current = undefined;
      void flushVisibleReads();
    }, 120);
  }, [flushVisibleReads]);
  useEffect(() => {
    mountedRef.current = true;
    messagesRef.current = [];
    historyClearedAtRef.current = null;
    visibleMessageIdsRef.current.clear();
    readRequestedIdsRef.current.clear();
    readInFlightIdsRef.current.clear();
    setMessages([]);
    const onRealtimeMessage = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeMessage>).detail;
      if (payload?.conversationId !== conversationId) return;
      void syncMessages(true).then(() => { router.refresh(); if (!shouldStickRef.current) setNewMessageCount((count) => count + 1); });
    };
    const onSync = () => { void syncMessages(true); };
    const onReadReceipt = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeMessage>).detail;
      if (payload?.conversationId !== conversationId) return;
      const updated = applyReadReceipt(messagesRef.current, payload);
      if (updated !== messagesRef.current) { messagesRef.current = updated; setMessages(updated); }
    };
    const onStatus = (event: Event) => { const status = (event as CustomEvent<{ status?: typeof connectionStatus }>).detail?.status; if (status) setConnectionStatus(status); };
    window.addEventListener("riezz99:realtime-message", onRealtimeMessage);
    window.addEventListener("riezz99:realtime-read-receipt", onReadReceipt);
    window.addEventListener("riezz99:realtime-sync", onSync);
    window.addEventListener("riezz99:realtime-status", onStatus);
    void syncMessages(false);
    let pollTimer: number | undefined;
    const updatePolling = () => {
      if (pollTimer !== undefined) { window.clearInterval(pollTimer); pollTimer = undefined; }
      if (document.visibilityState === "visible" && navigator.onLine) pollTimer = window.setInterval(() => { void syncMessages(true); }, 15000);
    };
    updatePolling();
    document.addEventListener("visibilitychange", updatePolling);
    window.addEventListener("online", updatePolling);
    window.addEventListener("offline", updatePolling);
    return () => { mountedRef.current = false; if (pollTimer !== undefined) window.clearInterval(pollTimer); document.removeEventListener("visibilitychange", updatePolling); window.removeEventListener("online", updatePolling); window.removeEventListener("offline", updatePolling); window.removeEventListener("riezz99:realtime-message", onRealtimeMessage); window.removeEventListener("riezz99:realtime-read-receipt", onReadReceipt); window.removeEventListener("riezz99:realtime-sync", onSync); window.removeEventListener("riezz99:realtime-status", onStatus); };
  }, [conversationId, router, scrollToBottom, syncMessages]);
  useEffect(() => { if (shouldStickRef.current) scrollToBottom(); }, [messages.length, scrollToBottom]);
  useEffect(() => {
    const onActive = () => scheduleVisibleReads();
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => { document.removeEventListener("visibilitychange", onActive); window.removeEventListener("focus", onActive); };
  }, [scheduleVisibleReads]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId;
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visibleMessageIdsRef.current.add(id);
        else visibleMessageIdsRef.current.delete(id);
      }
      scheduleVisibleReads();
    }, { root: list, threshold: [0, 0.5, 1] });
    messageNodesRef.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [messages, scheduleVisibleReads]);
  useEffect(() => () => { if (readTimerRef.current !== undefined) window.clearTimeout(readTimerRef.current); }, []);
  const setMessageNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) messageNodesRef.current.set(id, node);
    else messageNodesRef.current.delete(id);
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const incoming = Array.from(fileList);
    if (drafts.length + incoming.length > maxFiles) { setError("Maksimal 4 lampiran per pesan."); return; }
    const accepted: DraftAttachment[] = [];
    for (const file of incoming) {
      const knownType = file.type !== "";
      const kind = file.type.startsWith("image/") ? "IMAGE" : "VIDEO";
      const limit = kind === "IMAGE" ? maxImageBytes : maxVideoBytes;
      if (knownType && !acceptedTypes.has(file.type)) { setError("Format tidak didukung. Gunakan JPG, PNG, WEBP, MP4, atau MOV; SVG/HTML/executable ditolak."); continue; }
      if (file.size > limit) { setError(`${kind === "IMAGE" ? "Gambar" : "Video"} maksimal ${kind === "IMAGE" ? "10" : "50"} MB per file.`); continue; }
      accepted.push({ id: `draft:${crypto.randomUUID()}`, kind, mimeType: file.type || (kind === "IMAGE" ? "image/*" : "video/*"), byteSize: file.size, file, previewUrl: URL.createObjectURL(file), status: "pending", progress: 0 });
    }
    if (accepted.length) { setError(""); setDrafts((current) => [...current, ...accepted]); }
  }

  async function removeDraft(draft: DraftAttachment) {
    if (draft.status === "uploaded" && !draft.id.startsWith("draft:")) await fetch(`/api/conversations/${conversationId}/attachments/${draft.id}`, { method: "DELETE" });
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
  }

  async function send() {
    const trimmed = content.trim();
    if ((!trimmed && !drafts.length) || busy) return;
    setBusy(true); setError("");
    const uploadedIds: string[] = [];
    try {
      const uploaded = [] as Attachment[];
      for (const draft of drafts) {
        setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "uploading", progress: 0, error: undefined } : item));
        try {
          const attachment = await uploadAttachment(conversationId, draft, (progress) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, progress } : item)));
          uploaded.push({ ...attachment, previewUrl: draft.previewUrl });
          uploadedIds.push(attachment.id);
          setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, ...attachment, status: "uploaded", progress: 100 } : item));
        } catch (uploadError) {
          setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "error", error: uploadError instanceof Error ? uploadError.message : "Upload gagal." } : item));
          throw uploadError;
        }
      }
      const optimisticId = `optimistic:${crypto.randomUUID()}`;
      const optimistic = { id: optimisticId, senderId: viewerId, content: trimmed, attachments: uploaded, createdAt: new Date().toISOString(), status: "sending" as const };
      setMessages((current) => [...current, optimistic]); messagesRef.current = [...messagesRef.current, optimistic]; setContent(""); setDrafts([]);
      const response = await fetch(`/api/conversations/${conversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: trimmed, attachmentIds: uploadedIds }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Gagal mengirim pesan. Coba lagi.");
      const serverMessage = data.message as Message;
      const withPreviews = { ...serverMessage, attachments: (serverMessage.attachments ?? []).map((attachment) => ({ ...attachment, previewUrl: uploaded.find((item) => item.id === attachment.id)?.previewUrl })) };
      setMessages((current) => {
        const reconciled = reconcileOptimisticMessage(current, optimisticId, data.message);
        return reconciled.map((message) => message.id === serverMessage.id ? withPreviews : message);
      });
      messagesRef.current = reconcileOptimisticMessage(messagesRef.current, optimisticId, data.message);
      messagesRef.current = messagesRef.current.map((message) => message.id === serverMessage.id ? withPreviews : message);
      router.refresh();
    } catch (sendError: unknown) {
      if (uploadedIds.length) await Promise.all(uploadedIds.map((id) => fetch(`/api/conversations/${conversationId}/attachments/${id}`, { method: "DELETE" }).catch(() => undefined)));
      setMessages((current) => current.map((message) => message.status === "sending" ? { ...message, status: "failed" } : message));
      messagesRef.current = messagesRef.current.map((message) => message.status === "sending" ? { ...message, status: "failed" } : message);
      setError(sendError instanceof Error ? sendError.message : "Gagal mengirim pesan. Coba lagi.");
      window.dispatchEvent(new CustomEvent<ToastRequest>("riezz99:toast", { detail: { title: "Gagal mengirim pesan. Coba lagi.", type: "error" } }));
    } finally { setBusy(false); }
  }
  async function remove() { if (!window.confirm("Hapus chat ini dari daftar kamu?")) return; setBusy(true); const response = await fetch(`/api/conversations/${conversationId}/messages`, { method: "DELETE" }); if (response.ok) router.push(basePath as never); else { setError("Chat gagal dihapus."); setBusy(false); } }
  return (
    <main className="mx-auto max-w-2xl px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.2em] text-coral">Percakapan</p>
          <h1 className="display mt-2 text-4xl font-bold">Chat</h1>
          <p className="mt-2 flex items-center gap-2 text-xs text-ink/55">
            <span className={"h-2 w-2 rounded-full " + (connectionStatus === "connected" ? "bg-emerald-500" : "bg-amber-500")} aria-hidden="true" />
            {connectionStatus === "connected" ? "Terhubung" : connectionStatus === "reconnecting" ? "Menghubungkan ulang..." : "Menghubungkan..."}
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-full border border-red-200 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50">Hapus Chat</button>
      </div>

      <div
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          shouldStickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
          if (shouldStickRef.current) setNewMessageCount(0);
        }}
        className="relative mt-8 max-h-[min(60vh,34rem)] min-h-80 space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-soft"
      >
        {messages.length ? messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDate = !previous || messageDayKey(previous.createdAt) !== messageDayKey(message.createdAt);
          const ownMessage = message.senderId === viewerId;
          const saved = !message.status;
          return (
            <div key={message.id}>
              {showDate && <div className="my-5 flex items-center gap-3 text-[11px] font-bold text-ink/45 before:h-px before:flex-1 before:bg-ink/10 after:h-px after:flex-1 after:bg-ink/10"><span>{formatMessageDate(message.createdAt)}</span></div>}
              <div
                ref={(node) => setMessageNode(message.id, node)}
                data-message-id={message.id}
                className={"rounded-xl bg-sand p-3 text-sm " + (message.status === "failed" ? "opacity-60" : "")}
              >
                <p className="mb-1 text-xs font-bold text-coral">
                  {message.status === "sending" ? "Mengirim..." : message.status === "failed" ? "Gagal dikirim" : ownMessage ? "Anda" : message.sender?.role === "ADMIN" ? "Admin Riezz99" : message.sender?.name ?? "Pengguna"}
                </p>
                {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                {message.attachments?.length ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {message.attachments.map((attachment) => {
                      const source = attachment.previewUrl ?? mediaUrl(conversationId, attachment.id);
                      const fileUrl = downloadUrl(conversationId, attachment.id);
                      const downloadDisabled = message.status === "sending" || message.status === "failed";
                      return (
                        <div key={attachment.id} className="overflow-hidden rounded-lg border border-ink/10 bg-white p-2">
                          {attachment.kind === "IMAGE"
                            ? <button type="button" onClick={() => setSelectedImage({ source, downloadUrl: fileUrl })} className="block w-full overflow-hidden rounded-lg text-left" aria-label="Perbesar gambar"><img src={source} alt="Gambar lampiran" className="max-h-64 w-full object-cover" /></button>
                            : <video src={source} controls preload="metadata" className="max-h-72 w-full rounded-lg" />}
                          <div className="mt-2 flex justify-end">
                            {downloadDisabled
                              ? <button type="button" disabled className="min-h-11 rounded-lg border border-ink/10 px-4 py-2 text-sm font-bold text-ink/40">Unduh</button>
                              : <AttachmentDownloadButton url={fileUrl} label="Unduh" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-ink/45">
                  <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                  {ownMessage && saved && <span aria-label={message.readAt ? "Sudah dibaca" : "Tersimpan di server"} title={message.readAt ? "Sudah dibaca" : "Tersimpan di server"}>{message.readAt ? "✓✓" : "✓"}</span>}
                </div>
              </div>
            </div>
          );
        }) : <p className="py-24 text-center text-sm text-ink/50">Belum ada pesan. Mulai percakapan ini.</p>}
        {newMessageCount > 0 && <button type="button" onClick={scrollToBottom} className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-coral px-4 py-2 text-xs font-bold text-white shadow-lg">Pesan baru</button>}
      </div>

      <div className="mt-4 rounded-xl border border-ink/10 bg-white p-3">
        <div className="chat-composer flex items-end gap-2">
          <textarea aria-label="Tulis pesan" value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={2000} rows={2} placeholder="Tulis pesan..." className="min-w-0 flex-1 resize-none border-0 bg-transparent p-0 outline-none" />
          <label className="shrink-0 cursor-pointer rounded-xl border border-ink/15 px-3 py-3 text-lg leading-none hover:bg-sand" aria-label="Tambah gambar atau video">
            <span aria-hidden="true">＋</span>
            <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} disabled={busy || drafts.length >= maxFiles} />
          </label>
          <button type="button" disabled={busy || (!content.trim() && !drafts.length)} onClick={() => void send()} className="shrink-0 rounded-xl bg-ink px-5 py-3 font-bold text-white disabled:opacity-50">Kirim</button>
        </div>
        {drafts.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {drafts.map((draft) => <div key={draft.id} className="relative overflow-hidden rounded-lg border border-ink/10 bg-sand p-2">
            {draft.kind === "IMAGE" ? <img src={draft.previewUrl} alt="Preview gambar" className="h-24 w-full rounded object-cover" /> : <video src={draft.previewUrl} muted controls preload="metadata" className="h-24 w-full rounded object-cover" />}
            <div className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{mediaLabel(draft)} · {formatBytes(draft.byteSize)}</span>
              <button type="button" disabled={busy && draft.status === "uploading"} onClick={() => void removeDraft(draft)} className="font-bold text-red-700">Hapus</button>
            </div>
            {draft.status === "uploading" && <div className="mt-1 h-1.5 overflow-hidden rounded bg-white"><div className="h-full bg-coral transition-all" style={{ width: String(draft.progress) + "%" }} /></div>}
            {draft.status === "error" && <p className="mt-1 text-xs text-red-700">{draft.error}</p>}
            {draft.status === "uploaded" && <p className="mt-1 text-xs text-emerald-700">Unggahan selesai</p>}
          </div>)}
        </div>}
        <p className="mt-2 text-xs leading-5 text-ink/50">Maksimal 4 lampiran. Gambar: JPG/PNG/WEBP hingga 10 MB. Video: MP4/MOV hingga 50 MB.</p>
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {selectedImage && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelectedImage(null)}>
        <button type="button" aria-label="Tutup gambar" className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-2xl" onClick={() => setSelectedImage(null)}>×</button>
        <div className="flex max-h-[90vh] max-w-full flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
          <img src={selectedImage.source} alt="Gambar diperbesar" className="max-h-[calc(90vh-5rem)] max-w-full object-contain" />
          <AttachmentDownloadButton url={selectedImage.downloadUrl} />
        </div>
      </div>}
    </main>
  );
}
