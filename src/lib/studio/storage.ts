import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxReferenceBytes = 10 * 1024 * 1024;
export const MAX_STUDIO_OUTPUT_BYTES = 25 * 1024 * 1024;

function root() {
  const fallback = process.env.DIGITAL_STORAGE_ROOT ? path.join(process.env.DIGITAL_STORAGE_ROOT, "studio") : path.join(process.cwd(), "storage", "studio");
  return path.resolve(process.env.STUDIO_STORAGE_DIR ?? fallback);
}
export function studioStorageRoot() { return root(); }

async function write(key: string, data: Buffer) {
  const base = root();
  await mkdir(base, { recursive: true, mode: 0o750 });
  await access(base);
  const target = path.resolve(base, key);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Storage key tidak valid.");
  const temporary = path.join(base, `.${key}.tmp`);
  try { await writeFile(temporary, data, { flag: "wx", mode: 0o640 }); await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

export async function saveStudioReference(file: File) {
  if (!allowedTypes.has(file.type) || file.size <= 0 || file.size > maxReferenceBytes) throw new Error("Reference harus JPG, PNG, atau WEBP dengan ukuran maksimal 10 MB.");
  const data = Buffer.from(await file.arrayBuffer());
  try { await sharp(data, { limitInputPixels: 40_000_000 }).metadata(); } catch { throw new Error("Reference gambar tidak valid."); }
  const key = `reference-${randomUUID()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
  await write(key, data);
  return key;
}

export async function saveStudioOutput(data: Buffer, mimeType: string) {
  if (!allowedTypes.has(mimeType) || data.length === 0 || data.length > MAX_STUDIO_OUTPUT_BYTES) throw new Error("Output provider tidak valid.");
  try { await sharp(data, { limitInputPixels: 80_000_000 }).metadata(); } catch { throw new Error("Output provider bukan gambar valid."); }
  const key = `output-${randomUUID()}.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"}`;
  await write(key, data);
  return { storageKey: key, byteSize: data.length, mimeType };
}

export function resolveStudioPath(key: string) {
  if (!/^(reference|output)-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return null;
  const base = root(); const target = path.resolve(base, key);
  return target.startsWith(`${base}${path.sep}`) ? target : null;
}
export async function readStudioFile(key: string) { const target = resolveStudioPath(key); if (!target) throw new Error("File tidak ditemukan."); return readFile(target); }
export async function deleteStudioFile(key: string) {
  const target = resolveStudioPath(key);
  if (!target) throw new Error("Storage key tidak valid.");
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export async function listStudioFiles() { try { return (await readdir(root())).filter((key) => /^(reference|output)-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)); } catch { return []; } }
