import { open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const SOCIABUZZ_WAKE_MARKER_PATH = "/run/riezz-sociabuzz/wake";
export const SOCIABUZZ_WAKE_DEBOUNCE_MS = 60_000;
export const SOCIABUZZ_WAKE_MAX_BODY_BYTES = 8 * 1024;

type WakeResult = {
  debounced: boolean;
  wakeWritten: boolean;
  errorCategory?: "wake_write_failed";
};

type BodyResult = "ok" | "body_too_large" | "body_read_failed";

function markerPath() {
  // This override exists only for isolated tests; production uses the fixed marker.
  return process.env.SOCIABUZZ_WAKE_MARKER_PATH?.trim() || SOCIABUZZ_WAKE_MARKER_PATH;
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyLocked(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

/** Discards untrusted bytes without parsing or retaining them. */
export async function discardSociaBuzzWakeBody(request: Request): Promise<BodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > SOCIABUZZ_WAKE_MAX_BODY_BYTES)) {
    return "body_too_large";
  }
  if (!request.body) return "ok";

  const reader = request.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return "ok";
      total += value.byteLength;
      if (total > SOCIABUZZ_WAKE_MAX_BODY_BYTES) {
        await reader.cancel();
        return "body_too_large";
      }
    }
  } catch {
    return "body_read_failed";
  } finally {
    reader.releaseLock();
  }
}

/**
 * Atomically updates one fixed marker. A lock directory collapses concurrent
 * requests, while the marker mtime supplies the durable debounce window.
 */
export async function touchSociaBuzzWakeMarker(now = Date.now()): Promise<WakeResult> {
  const path = markerPath();
  const lockPath = `${path}.lock`;
  let lockCreated = false;
  let temporaryPath: string | undefined;

  try {
    const lock = await open(lockPath, "wx", 0o600);
    await lock.close();
    lockCreated = true;
  } catch (error) {
    if (isAlreadyLocked(error)) return { debounced: true, wakeWritten: false };
    return { debounced: false, wakeWritten: false, errorCategory: "wake_write_failed" };
  }

  try {
    try {
      const existing = await stat(path);
      if (now - existing.mtimeMs < SOCIABUZZ_WAKE_DEBOUNCE_MS) {
        return { debounced: true, wakeWritten: false };
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporaryPath, `${now}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
    temporaryPath = undefined;
    return { debounced: false, wakeWritten: true };
  } catch {
    return { debounced: false, wakeWritten: false, errorCategory: "wake_write_failed" };
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
    if (lockCreated) await unlink(lockPath).catch(() => undefined);
  }
}
