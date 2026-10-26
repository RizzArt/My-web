import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CHAT_MAX_IMAGE_BYTES, CHAT_MAX_VIDEO_BYTES, deleteChatMedia, getChatMediaDownloadFilename, resolveChatMediaPath, saveChatMedia } from "@/lib/storage/chat-media";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const minimalMp4 = Buffer.from("000000186674797069736f6d0000020069736f6d69736f3261766331", "hex");
let temporaryDirectory = "";

afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = ""; delete process.env.CHAT_MEDIA_STORAGE_DIR; });

describe("private chat media storage", () => {
  it("detects actual image bytes instead of trusting filename or MIME", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-chat-media-"));
    process.env.CHAT_MEDIA_STORAGE_DIR = temporaryDirectory;
    const saved = await saveChatMedia(new File([onePixelPng], "payload.exe", { type: "application/octet-stream" }));
    expect(saved.kind).toBe("IMAGE");
    expect(saved.mimeType).toBe("image/png");
    await expect(readFile(path.join(temporaryDirectory, saved.storageKey))).resolves.toEqual(onePixelPng);
  });

  it("accepts a video container signature and rejects SVG/HTML/executable content", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-chat-media-"));
    process.env.CHAT_MEDIA_STORAGE_DIR = temporaryDirectory;
    const saved = await saveChatMedia(new File([minimalMp4], "clip.txt", { type: "text/plain" }));
    expect(saved.kind).toBe("VIDEO");
    await expect(saveChatMedia(new File(["<svg></svg>"], "x.svg", { type: "image/svg+xml" }))).rejects.toThrow("Format tidak didukung");
    await expect(saveChatMedia(new File(["<html>bad</html>"], "x.mp4", { type: "video/mp4" }))).rejects.toThrow("Format tidak didukung");
    await expect(saveChatMedia(new File(["MZ executable"], "x.exe", { type: "application/octet-stream" }))).rejects.toThrow("Format tidak didukung");
  });

  it("enforces image/video limits and keeps path resolution inside private storage", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-chat-media-"));
    process.env.CHAT_MEDIA_STORAGE_DIR = temporaryDirectory;
    const oversizedImage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), new Uint8Array(CHAT_MAX_IMAGE_BYTES)]);
    await expect(saveChatMedia(new File([oversizedImage], "x.jpg", { type: "image/jpeg" }))).rejects.toThrow("10 MB");
    await expect(saveChatMedia(new File([new Uint8Array(CHAT_MAX_VIDEO_BYTES + 1)], "x.mp4", { type: "video/mp4" }))).rejects.toThrow("50 MB");
    expect(resolveChatMediaPath("../../etc/passwd")).toBeNull();
    await deleteChatMedia("../../etc/passwd");
  });

  it("creates a header-safe download name without using an upload filename", () => {
    expect(getChatMediaDownloadFilename('bad"\r\nfilename', "IMAGE", "123e4567-e89b-12d3-a456-426614174000.jpg")).toBe("chat-gambar-bad-filename.jpg");
    expect(getChatMediaDownloadFilename("attachment-1", "VIDEO", "123e4567-e89b-12d3-a456-426614174000.mp4")).toBe("chat-video-attachment-1.mp4");
  });
});
