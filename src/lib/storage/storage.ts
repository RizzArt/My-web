import { randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const managedImagePattern = /^\/uploads\/products\/[a-f0-9-]+\.webp$/;
const managedStoreImagePattern = /^\/uploads\/stores\/[a-f0-9-]+\.webp$/;
const supportedFormats = new Set(["jpeg", "png", "webp"]);

function isHeifContainer(input: Buffer) {
  if (input.length < 12 || input.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= Math.min(input.length, 512); offset += 4) {
    brands.push(input.subarray(offset, offset + 4).toString("ascii"));
  }
  return brands.some((brand) => /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) && !brands.includes("avif") && !brands.includes("avis");
}

function supportedFormatMessage() {
  return "Format gambar harus JPG, PNG, atau WEBP.";
}

function heifUnsupportedMessage() {
  return "Format HEIC/HEIF belum didukung server ini. Gunakan JPG, PNG, atau WEBP.";
}

async function readAndDecode(file: File) {
  if (file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_BYTES) throw new Error("Ukuran gambar maksimal 5 MB.");
  const input = Buffer.from(await file.arrayBuffer());
  if (input.length <= 0 || input.length > MAX_PRODUCT_IMAGE_BYTES) throw new Error("Ukuran gambar maksimal 5 MB.");
  const heifCandidate = isHeifContainer(input);
  if (heifCandidate) throw new Error(heifUnsupportedMessage());
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (supportedFormats.has(metadata.format ?? "")) return image;
    throw new Error(supportedFormatMessage());
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Format gambar") || error.message.startsWith("Format HEIC/HEIF"))) throw error;
    throw new Error("Gagal memproses gambar. Pastikan file JPG, PNG, atau WEBP valid.");
  }
}

export type ProductImageKind = "thumbnail" | "gallery";
export type StoreImageKind = "logo" | "banner";

export interface StorageProvider {
  saveProductImage(file: File, kind: ProductImageKind): Promise<string>;
  saveStoreImage(file: File, kind: StoreImageKind): Promise<string>;
  deleteProductImage(url: string): Promise<void>;
}

function storageRoot() {
  return path.resolve(process.env.PRODUCT_STORAGE_DIR ?? "/home/harnet/digital-store/storage/products");
}

export function productStorageRoot() { return storageRoot(); }

export function isManagedProductImage(url: string | null | undefined) {
  return Boolean(url && managedImagePattern.test(url));
}

function imagePath(url: string) {
  if (isManagedProductImage(url)) return path.join(storageRoot(), path.basename(url));
  if (managedStoreImagePattern.test(url)) return path.join(path.dirname(storageRoot()), "stores", path.basename(url));
  return null;
}

export class LocalStorageProvider implements StorageProvider {
  async saveProductImage(file: File, kind: ProductImageKind) {
    const image = await readAndDecode(file);
    let output: Buffer;
    try {
      output = await image.rotate().resize({ width: kind === "thumbnail" ? 1200 : 1600, height: kind === "thumbnail" ? 1200 : 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new Error("Gagal memproses gambar. Coba file gambar lain.");
    }
    const root = storageRoot();
    try { await mkdir(root, { recursive: true, mode: 0o750 }); await access(root); } catch { throw new Error("Storage gambar tidak dapat ditulis."); }
    const filename = `${randomUUID()}.webp`;
    const temporaryPath = path.join(root, `.${filename}.tmp`);
    const targetPath = path.join(root, filename);
    try {
      await writeFile(temporaryPath, output, { flag: "wx", mode: 0o640 });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === "EACCES" || code === "EPERM") throw new Error("Tidak punya izin upload gambar.");
      throw new Error("Storage gambar tidak dapat ditulis.");
    }
    return `/uploads/products/${filename}`;
  }

  async saveStoreImage(file: File, kind: StoreImageKind) {
    const image = await readAndDecode(file);
    const output = await image.rotate().resize({ width: kind === "logo" ? 1000 : 1800, height: kind === "logo" ? 1000 : 900, fit: kind === "logo" ? "cover" : "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const root = path.join(path.dirname(storageRoot()), "stores");
    await mkdir(root, { recursive: true, mode: 0o750 });
    const filename = `${randomUUID()}.webp`;
    const temporaryPath = path.join(root, `.${filename}.tmp`);
    const targetPath = path.join(root, filename);
    try {
      await writeFile(temporaryPath, output, { flag: "wx", mode: 0o640 });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === "EACCES" || code === "EPERM") throw new Error("Tidak punya izin upload gambar.");
      throw new Error("Storage gambar tidak dapat ditulis.");
    }
    return `/uploads/stores/${filename}`;
  }

  async deleteProductImage(url: string) {
    const targetPath = imagePath(url);
    if (targetPath) await unlink(targetPath).catch(() => undefined);
  }
}

let provider: StorageProvider | undefined;
export function getStorageProvider() {
  provider ??= new LocalStorageProvider();
  return provider;
}

export async function deleteManagedProductImages(urls: (string | null | undefined)[]) {
  await Promise.all(urls.filter((url): url is string => isManagedProductImage(url)).map((url) => getStorageProvider().deleteProductImage(url)));
}
