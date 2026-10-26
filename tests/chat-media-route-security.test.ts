import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findConversation: vi.fn(), findAttachment: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { conversation: { findUnique: mocks.findConversation }, chatAttachment: { findFirst: mocks.findAttachment } } }));
import { GET } from "../src/app/api/conversations/[conversationId]/attachments/[attachmentId]/media/route";
import { GET as GET_DOWNLOAD } from "../src/app/api/conversations/[conversationId]/attachments/[attachmentId]/download/route";

const uploadRoute = readFileSync(new URL("../src/app/api/conversations/[conversationId]/attachments/route.ts", import.meta.url), "utf8");
const mediaRoute = readFileSync(new URL("../src/app/api/conversations/[conversationId]/attachments/[attachmentId]/media/route.ts", import.meta.url), "utf8");
const downloadRoute = readFileSync(new URL("../src/app/api/conversations/[conversationId]/attachments/[attachmentId]/download/route.ts", import.meta.url), "utf8");
const messageRoute = readFileSync(new URL("../src/app/api/conversations/[conversationId]/messages/route.ts", import.meta.url), "utf8");
const cleanup = readFileSync(new URL("../scripts/cleanup-chat-attachments.ts", import.meta.url), "utf8");
let temporaryDirectory = "";

afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = ""; delete process.env.CHAT_MEDIA_STORAGE_DIR; });
beforeEach(() => { vi.resetAllMocks(); });

describe("chat media route security", () => {
  it("requires the authenticated conversation participant before upload or download", () => {
    expect(uploadRoute).toContain("const session = await auth()");
    expect(uploadRoute).toContain("canAccessConversation(conversation, session.user)");
    expect(mediaRoute).toContain("const session = await auth()");
    expect(mediaRoute).toContain("canAccessConversation(conversation, session.user)");
    expect(mediaRoute).toContain("where: { id: attachmentId, conversationId");
    expect(mediaRoute).toContain("resolveChatMediaPath(attachment.storageKey)");
    expect(downloadRoute).toContain("const session = await auth()");
    expect(downloadRoute).toContain("canAccessConversation(conversation, session.user)");
    expect(downloadRoute).toContain("messageId: { not: null }");
    expect(downloadRoute).toContain('"Content-Disposition": `attachment;');
  });

  it("serves media to a participant and blocks a different conversation", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-chat-route-"));
    process.env.CHAT_MEDIA_STORAGE_DIR = temporaryDirectory;
    const storageKey = "123e4567-e89b-12d3-a456-426614174000.jpg";
    await writeFile(path.join(temporaryDirectory, storageKey), Buffer.from("private-image"));
    mocks.auth.mockResolvedValue({ user: { id: "buyer-1", role: "CUSTOMER" } });
    mocks.findConversation.mockResolvedValue({ customerId: "buyer-1", sellerId: null, seller: null, adminSupport: true });
    mocks.findAttachment.mockResolvedValue({ storageKey, mimeType: "image/jpeg" });
    const allowed = await GET(new Request("http://localhost/media"), { params: Promise.resolve({ conversationId: "conversation-1", attachmentId: "attachment-1" }) });
    expect(allowed.status).toBe(200);
    expect(Buffer.from(await allowed.arrayBuffer()).toString()).toBe("private-image");
    const range = await GET(new Request("http://localhost/media", { headers: { Range: "bytes=1-4" } }), { params: Promise.resolve({ conversationId: "conversation-1", attachmentId: "attachment-1" }) });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 1-4/13");
    expect(Buffer.from(await range.arrayBuffer()).toString()).toBe("riva");

    mocks.findConversation.mockResolvedValue({ customerId: "buyer-2", sellerId: null, seller: null, adminSupport: true });
    const forbidden = await GET(new Request("http://localhost/media"), { params: Promise.resolve({ conversationId: "conversation-1", attachmentId: "attachment-1" }) });
    expect(forbidden.status).toBe(403);
  });

  it("downloads a sent attachment for a participant with safe attachment headers", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-chat-download-"));
    process.env.CHAT_MEDIA_STORAGE_DIR = temporaryDirectory;
    const storageKey = "123e4567-e89b-12d3-a456-426614174000.jpg";
    await writeFile(path.join(temporaryDirectory, storageKey), Buffer.from("private-download"));
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.findConversation.mockResolvedValue({ customerId: "buyer-1", sellerId: null, seller: null, adminSupport: true });
    mocks.findAttachment.mockResolvedValue({ id: "attachment-1", storageKey, kind: "IMAGE", mimeType: "image/jpeg" });

    mocks.auth.mockResolvedValue(null);
    const unauthenticated = await GET_DOWNLOAD(new Request("http://localhost/download"), { params: Promise.resolve({ conversationId: "conversation-1", attachmentId: "attachment-1" }) });
    expect(unauthenticated.status).toBe(401);

    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    const response = await GET_DOWNLOAD(new Request("http://localhost/download"), { params: Promise.resolve({ conversationId: "conversation-1", attachmentId: "attachment-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="chat-gambar-attachment-1.jpg"; filename*=UTF-8\'\'chat-gambar-attachment-1.jpg');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("private-download");

    mocks.auth.mockResolvedValue({ user: { id: "customer-other", role: "CUSTOMER" } });
    const forbidden = await GET_DOWNLOAD(new Request("http://localhost/download"), { params: Promise.resolve({ conversationId: "conversation-1", attachmentId: "attachment-1" }) });
    expect(forbidden.status).toBe(403);
  });

  it("does not make media public and only serves sent attachments", () => {
    expect(mediaRoute).toContain("messageId: { not: null }");
    expect(mediaRoute).toContain('"Cache-Control": "private, no-store"');
    expect(downloadRoute).toContain('"Cache-Control": "private, no-store"');
    expect(downloadRoute).toContain("getChatMediaDownloadFilename");
    expect(uploadRoute).not.toContain("/public/");
    expect(uploadRoute).toContain("CHAT_MAX_ATTACHMENTS");
    expect(messageRoute).toContain("messageId: null");
    expect(messageRoute).toContain("attachments: { connect:");
  });

  it("keeps failed and stale uploads cleanable without selecting used attachments", () => {
    expect(uploadRoute).toContain("if (stored) await deleteChatMedia(stored.storageKey)");
    expect(cleanup).toContain("messageId: null");
    expect(cleanup).toContain("createdAt: { lt: cutoff }");
    expect(cleanup).toContain("deleteChatMedia(attachment.storageKey)");
  });
});
