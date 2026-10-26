import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { LocalStorageProvider, MAX_PRODUCT_IMAGE_BYTES } from "@/lib/storage/storage";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let temporaryDirectory = "";

afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = ""; delete process.env.PRODUCT_STORAGE_DIR; });

describe("local product image storage", () => {
  it("accepts image content even when the supplied MIME is untrusted", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-images-"));
    process.env.PRODUCT_STORAGE_DIR = temporaryDirectory;
    const url = await new LocalStorageProvider().saveProductImage(new File([onePixelPng], "payload.exe", { type: "application/octet-stream" }), "thumbnail");
    expect(url).toMatch(/^\/uploads\/products\/[a-f0-9-]+\.webp$/);
    await expect(readFile(path.join(temporaryDirectory, path.basename(url)))).resolves.toBeInstanceOf(Buffer);
  });

  it("rejects invalid content and oversized files", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-images-"));
    process.env.PRODUCT_STORAGE_DIR = temporaryDirectory;
    const storage = new LocalStorageProvider();
    await expect(storage.saveProductImage(new File(["not an image"], "image.jpg", { type: "image/jpeg" }), "gallery")).rejects.toThrow();
    await expect(storage.saveProductImage(new File(["<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"><rect width=\"2\" height=\"2\"/></svg>"], "image.svg", { type: "image/svg+xml" }), "gallery")).rejects.toThrow("Format gambar");
    await expect(storage.saveProductImage(new File([new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }), "gallery")).rejects.toThrow("5 MB");
  });

  it("normalizes EXIF orientation before storing the persistent WebP", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-images-"));
    process.env.PRODUCT_STORAGE_DIR = temporaryDirectory;
    const input = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const url = await new LocalStorageProvider().saveProductImage(new File([input], "iphone.JPG", { type: "image/jpeg" }), "gallery");
    const metadata = await sharp(await readFile(path.join(temporaryDirectory, path.basename(url)))).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(2);
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects HEIC with a clear fallback message even when a decoder is installed", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "digital-store-images-"));
    process.env.PRODUCT_STORAGE_DIR = temporaryDirectory;
    const heic = Buffer.alloc(32);
    heic.writeUInt32BE(24, 0);
    heic.write("ftyp", 4, "ascii");
    heic.write("heic", 8, "ascii");
    await expect(new LocalStorageProvider().saveProductImage(new File([heic], "image.heic", { type: "image/heic" }), "gallery"))
      .rejects.toThrow("Format HEIC/HEIF belum didukung server ini. Gunakan JPG, PNG, atau WEBP.");
  });
});
