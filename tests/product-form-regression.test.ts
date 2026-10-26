import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/components/product-form.tsx"), "utf8");
const uploadRoute = readFileSync(path.join(process.cwd(), "src/app/api/products/upload/route.ts"), "utf8");
const sellerCreateRoute = readFileSync(path.join(process.cwd(), "src/app/api/seller/products/route.ts"), "utf8");
const adminCreateRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/products/route.ts"), "utf8");
const nginxLocation = readFileSync(path.join(process.cwd(), "deployment/nginx/product-upload-location.conf"), "utf8");
const nginxInstaller = readFileSync(path.join(process.cwd(), "deployment/install-product-upload-nginx.sh"), "utf8");

describe("product form submission flow", () => {
  it("captures the HTML form before async uploads", () => {
    expect(source).toContain("const form = event.currentTarget;");
    expect(source).toContain("Object.fromEntries(new FormData(form))");
    expect(source).not.toContain("new FormData(event.currentTarget)");
  });

  it("uses an empty FormData for file uploads and a submit button for saving", () => {
    expect(source).toContain("const body = new FormData();");
    expect(source).toContain('body.append("file", file)');
    expect(source).toContain('<button type="submit"');
    expect(source).not.toMatch(/new FormData\((?:file|body|event\.currentTarget)\)/);
  });

  it("keeps successful media, reports each failed item, and makes create retries idempotent", () => {
    expect(source).toContain("XMLHttpRequest");
    expect(source).toContain("setGallery([...nextGallery])");
    expect(source).toContain("Upload gagal untuk");
    expect(source).toContain('headers["Idempotency-Key"]');
    expect(source).toContain("statusLabel");
    expect(source).toContain("setUploadStatus");
  });

  it("offers only formats supported by this release", () => {
    expect(source).toContain('const imageAccept = "image/jpeg,image/png,image/webp"');
    expect(source).toContain("HEIC/HEIF belum didukung server ini");
  });

  it("keeps request and proxy limits aligned for one-file uploads", () => {
    expect(uploadRoute).toContain("export const maxDuration = 180");
    expect(nginxLocation).toContain("client_max_body_size 6m");
    expect(nginxLocation).toContain("client_body_timeout 180s");
    expect(nginxLocation).toContain("proxy_request_buffering off");
  });

  it("prepares product-only Nginx installation with rollback and no reload", () => {
    expect(nginxInstaller).toContain('cp -a -- "$SITE_FILE" "$backup_dir/digital-store"');
    expect(nginxInstaller).toContain("if nginx -t; then");
    expect(nginxInstaller).toContain('install -o "$site_uid" -g "$site_gid" -m "$site_mode" "$backup_dir/digital-store" "$SITE_FILE"');
    expect(nginxInstaller).not.toMatch(/^\s*(nginx -s reload|systemctl (reload|restart))/m);
    expect(nginxInstaller).toContain("/api/products/upload");
    expect(nginxInstaller).toContain("/api/conversations/");
    expect(nginxInstaller).toContain("/api/realtime/stream");
  });

  it("protects new product creation from a lost response retry", () => {
    for (const route of [sellerCreateRoute, adminCreateRoute]) {
      expect(route).toContain("PRODUCT_CREATE_IDEMPOTENCY");
      expect(route).toContain("metadata: { path: [\"idempotencyKey\"]");
    }
  });
});
