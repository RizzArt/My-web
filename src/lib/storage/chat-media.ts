import { randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const CHAT_MAX_ATTACHMENTS = 4;
export const CHAT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CHAT_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const CHAT_MAX_UPLOAD_BYTES = CHAT_MAX_VIDEO_BYTES;
export const CHAT_UPLOAD_RATE_FILES = 20;
export const CHAT_UPLOAD_RATE_BYTES = 250 * 1024 * 1024;

export const CHAT_SUPPORTED_FORMATS = "JPG, PNG, WEBP, MP4, atau MOV";

export type ChatMediaKind = "IMAGE" | "VIDEO";
export type ChatMediaDescriptor = {
  kind: ChatMediaKind;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/quicktime";
  extension: "jpg" | "png" | "webp" | "mp4" | "mov";
};

const chatMediaMimeTypes = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
} as const;

function storageRoot() {
  const defaultRoot = process.env.DIGITAL_STORAGE_ROOT
    ? path.join(process.env.DIGITAL_STORAGE_ROOT, "chat-media")
    : process.env.PRODUCT_STORAGE_DIR
      ? path.join(path.dirname(process.env.PRODUCT_STORAGE_DIR), "chat-media")
      : path.join(process.cwd(), "storage", "chat-media");
  return path.resolve(process.env.CHAT_MEDIA_STORAGE_DIR ?? defaultRoot);
}

export function chatMediaStorageRoot() {
  return storageRoot();
}

function ascii(buffer: Buffer, start: number, length: number) {
  return buffer.subarray(start, start + length).toString("ascii");
}

function detectFormat(buffer: Buffer): ChatMediaDescriptor | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { kind: "IMAGE", mimeType: "image/jpeg", extension: "jpg" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "IMAGE", mimeType: "image/png", extension: "png" };
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") return { kind: "IMAGE", mimeType: "image/webp", extension: "webp" };

  if (ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4);
    if (brand === "qt  ") return { kind: "VIDEO", mimeType: "video/quicktime", extension: "mov" };
    if (["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "hvc1", "hev1", "M4V "].includes(brand)) {
      return { kind: "VIDEO", mimeType: "video/mp4", extension: "mp4" };
    }
  }
  return null;
}

function maxBytes(kind: ChatMediaKind) {
  return kind === "IMAGE" ? CHAT_MAX_IMAGE_BYTES : CHAT_MAX_VIDEO_BYTES;
}

export function validateChatMediaSize(size: number, kind: ChatMediaKind) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("File lampiran kosong atau tidak valid.");
  if (size > maxBytes(kind)) throw new Error(`${kind === "IMAGE" ? "Gambar" : "Video"} maksimal ${kind === "IMAGE" ? "10" : "50"} MB per file.`);
}

export async function saveChatMedia(file: File) {
  if (file.size <= 0 || file.size > CHAT_MAX_UPLOAD_BYTES) throw new Error("Ukuran file melebihi batas upload 50 MB.");
  const input = Buffer.from(await file.arrayBuffer());
  const descriptor = detectFormat(input);
  if (!descriptor) throw new Error(`Format tidak didukung. Gunakan ${CHAT_SUPPORTED_FORMATS}. SVG, HTML, dan executable ditolak.`);
  validateChatMediaSize(input.length, descriptor.kind);

  if (descriptor.kind === "IMAGE") {
    try {
      const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
      if (metadata.format !== descriptor.extension && !(descriptor.extension === "jpg" && metadata.format === "jpeg")) throw new Error("Format gambar tidak cocok.");
    } catch {
      throw new Error("File gambar tidak valid atau rusak. Gunakan JPG, PNG, atau WEBP.");
    }
  }

  const root = storageRoot();
  try {
    await mkdir(root, { recursive: true, mode: 0o750 });
    await access(root);
  } catch {
    throw new Error("Storage lampiran tidak dapat ditulis.");
  }

  const storageKey = `${randomUUID()}.${descriptor.extension}`;
  const temporaryPath = path.join(root, `.${storageKey}.tmp`);
  const targetPath = path.join(root, storageKey);
  try {
    await writeFile(temporaryPath, input, { flag: "wx", mode: 0o640 });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code === "EACCES" || code === "EPERM") throw new Error("Tidak punya izin menyimpan lampiran.");
    throw new Error("Storage lampiran tidak dapat ditulis.");
  }
  return { ...descriptor, storageKey, byteSize: input.length };
}

export function resolveChatMediaPath(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov)$/.test(storageKey)) return null;
  const root = storageRoot();
  const target = path.resolve(root, storageKey);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

export function getChatMediaFileInfo(storageKey: string, mimeType: string) {
  const extension = storageKey.match(/\.([a-z0-9]+)$/)?.[1] as keyof typeof chatMediaMimeTypes | undefined;
  if (!extension || chatMediaMimeTypes[extension] !== mimeType) return null;
  return { extension, mimeType: chatMediaMimeTypes[extension] };
}

export function getChatMediaDownloadFilename(attachmentId: string, kind: ChatMediaKind, storageKey: string) {
  const extension = storageKey.match(/\.([a-z0-9]+)$/)?.[1] as keyof typeof chatMediaMimeTypes | undefined;
  if (!extension || !chatMediaMimeTypes[extension]) return null;
  const safeId = attachmentId.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64).replace(/^-|-$/g, "") || "attachment";
  return `chat-${kind === "IMAGE" ? "gambar" : "video"}-${safeId}.${extension}`;
}

export async function deleteChatMedia(storageKey: string) {
  const target = resolveChatMediaPath(storageKey);
  if (target) await unlink(target).catch(() => undefined);
}
