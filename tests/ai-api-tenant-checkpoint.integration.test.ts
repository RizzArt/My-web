import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { PrismaClient, Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKey } from "@/lib/ai-api/api-keys";
import { requestFingerprint } from "@/lib/ai-api/idempotency";
import { encryptAiApiResponseReplay } from "@/lib/ai-api/response-replay";

// Real isolated PostgreSQL, synthetic rows; schema-push tests locking, NOT
// migration/ledger-trigger safety or any real provider billing contract.
const ROOT = new URL("../", import.meta.url).pathname;
const PG = "/usr/lib/postgresql/16/bin";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function barrier() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function freePort() { return new Promise<number>((resolve, reject) => {
  const server = net.createServer(); server.on("error", reject); server.listen(0, "127.0.0.1", () => {
    const address = server.address(); if (!address || typeof address === "string") return reject(new Error("No fixture port"));
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
}); }
function run(file: string, args: string[], env = process.env) {
  const q = spawnSync(file, args, { env, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (q.status !== 0) throw new Error(`Disposable fixture command failed: ${file}; ${q.stderr.slice(-1000)}`);
}

describe.sequential("tenant authority checkpoint with disposable PostgreSQL 16", () => {
  let root = ""; let data = ""; let primary: PrismaClient; let writer: PrismaClient; let observer: PrismaClient;
  let mark: typeof import("@/lib/ai-api/service").markAiApiDispatching;
  let api: typeof import("@/lib/ai-api/service");
  let fixtureProviderAdmitted = true;
  const generated = createApiKey();
  let initialSystemIdentifier = "";
  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    root = mkdtempSync(join(tmpdir(), "tenant-authority-pg-")); data = join(root, "data");
    const port = await freePort(); const role = userInfo().username;
    run(join(PG, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
    run(join(PG, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -p ${port} -h 127.0.0.1 -c unix_socket_directories=''`, "-w", "start"]);
    run(join(PG, "createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", role, "tenant_authority_fixture"]);
    const url = `postgresql://${role}@127.0.0.1:${port}/tenant_authority_fixture?schema=public`;
    const u = new URL(url); expect(u.hostname).toBe("127.0.0.1"); expect(u.port).toBe(String(port)); expect(u.pathname).toBe("/tenant_authority_fixture");
    run(process.execPath, [join(ROOT, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", join(ROOT, "prisma/schema.prisma")], { ...process.env, DATABASE_URL: url });
    primary = new PrismaClient({ datasources: { db: { url } } }); writer = new PrismaClient({ datasources: { db: { url } } }); observer = new PrismaClient({ datasources: { db: { url } } });
    const identity = await primary.$queryRaw<Array<{ database: string; port: string; system: string }>>`SELECT current_database() AS database, current_setting('port') AS port, system_identifier::text AS system FROM pg_control_system()`;
    expect(identity[0].database).toBe("tenant_authority_fixture"); expect(identity[0].port).toBe(String(port)); initialSystemIdentifier = identity[0].system;
    await primary.user.create({ data: { id: "fixture-user", email: "tenant-fixture@example.test", isActive: true } });
    await primary.aiApiWallet.create({ data: { id: "fixture-wallet", userId: "fixture-user", reservedMicros: 1n } });
    await primary.aiApiKey.create({ data: { id: "fixture-key", walletId: "fixture-wallet", name: "synthetic", prefix: generated.prefix, secretHash: generated.secretHash } });
    await primary.aiApiModel.create({ data: { id: "fixture-model", publicId: "minimax/minimax-m3", provider: "SEKAI", upstreamModelId: "minimax/minimax-m3", displayName: "fixture", enabled: true, maxInputTokens: 32768, maxOutputTokens: 8192, privateBetaMaxOutputTokens: 8192, maxRequestBytes: 71680 } });
    await primary.aiApiProviderHealth.create({ data: { modelId: "fixture-model", breakerState: "CLOSED", healthyUntil: new Date("2099-01-01") } });
    await primary.aiApiPriceVersion.create({ data: { id: "fixture-price", modelId: "fixture-model", version: 1, upstreamInputMicrosPerMillion: 1n, upstreamOutputMicrosPerMillion: 1n, retailInputMicrosPerMillion: 1n, retailOutputMicrosPerMillion: 1n, calculatorVersion: "fixture", sourceVersion: "fixture", effectiveFrom: new Date("2026-01-01") } });
    await primary.aiApiRequest.create({ data: { id: "fixture-request", walletId: "fixture-wallet", apiKeyId: "fixture-key", modelId: "fixture-model", priceVersionId: "fixture-price", idempotencyKey: "fixture-idempotency", requestFingerprint: "fixture", upstreamIdempotencyKey: "fixture-upstream", reservedMicros: 1n, admissionDate: new Date() } });
    vi.doMock("@/lib/prisma", () => ({ prisma: primary }));
    vi.doMock("@/lib/ai-api/provider-policy", () => ({ customerBillingProviderAdmitted: (p: string) => fixtureProviderAdmitted && p === "SEKAI" }));
    api = await import("@/lib/ai-api/service"); mark = api.markAiApiDispatching;
  }, 90_000);
  beforeEach(async () => {
    fixtureProviderAdmitted = true;
    await primary.aiApiModel.update({ where: { id: "fixture-model" }, data: { enabled: true } });
    await primary.user.update({ where: { id: "fixture-user" }, data: { isActive: true } });
    await primary.aiApiWallet.update({ where: { id: "fixture-wallet" }, data: { isFrozen: false } });
    await primary.aiApiKey.update({ where: { id: "fixture-key" }, data: { status: "ACTIVE", expiresAt: null } });
    await primary.aiApiRequest.update({ where: { id: "fixture-request" }, data: { status: "RESERVED", dispatchStartedAt: null, responseReplayCiphertext: null, responseReplayExpiresAt: null } });
  });
  afterAll(async () => {
    await Promise.allSettled([primary?.$disconnect(), writer?.$disconnect(), observer?.$disconnect()]);
    if (data) {
      spawnSync(join(PG, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { encoding: "utf8", timeout: 15_000 });
      const status = spawnSync(join(PG, "pg_ctl"), ["-D", data, "status"], { encoding: "utf8", timeout: 5_000 });
      expect(status.status).not.toBe(0);
    }
    if (root) rmSync(root, { recursive: true, force: true });
    vi.doUnmock("@/lib/prisma"); vi.doUnmock("@/lib/ai-api/provider-policy");
  });
  it.each(["active", "banned", "revoked", "frozen", "expired"])("revalidates cached bearer authority before historical replay without new billing: %s", async (state) => {
    const chat = { model: "minimax/minimax-m3", messages: [{ role: "user" as const, content: "replay fixture" }], maxCompletionTokens: 32 };
    const fingerprint = requestFingerprint(chat);
    const response = { id: "fixture-private-response", object: "response", output: [] };
    const binding = { requestId: "fixture-request", apiKeyId: "fixture-key", walletId: "fixture-wallet", endpoint: "responses", requestFingerprint: fingerprint };
    const encrypted = encryptAiApiResponseReplay(response, binding);
    await primary.aiApiRequest.update({ where: { id: "fixture-request" }, data: { status: "COMPLETED", endpoint: "responses", requestFingerprint: fingerprint, finalChargeMicros: 0n, responseReplayCiphertext: encrypted.ciphertext, responseReplayExpiresAt: encrypted.expiresAt } });
    const auth = await api.authenticateAiApiKey(generated.plaintext);
    const ingress = await api.acquireAiApiIngressAdmission(auth);
    if (state === "banned") await writer.user.update({ where: { id: "fixture-user" }, data: { isActive: false } });
    if (state === "revoked") await writer.aiApiKey.update({ where: { id: "fixture-key" }, data: { status: "REVOKED" } });
    if (state === "frozen") await writer.aiApiWallet.update({ where: { id: "fixture-wallet" }, data: { isFrozen: true } });
    if (state === "expired") await writer.aiApiKey.update({ where: { id: "fixture-key" }, data: { expiresAt: new Date(0) } });
    fixtureProviderAdmitted = false;
    await primary.aiApiModel.update({ where: { id: "fixture-model" }, data: { enabled: false } });
    const before = await primary.aiApiWallet.findUniqueOrThrow({ where: { id: "fixture-wallet" } });
    const provider = { complete: vi.fn() };
    try {
      const result = api.executeAiApiChat({ auth, request: chat, endpoint: "responses", idempotencyKey: "fixture-idempotency", replayCompletedResponse: true, provider, ingressLeaseId: ingress.id });
      if (state === "active") await expect(result).resolves.toMatchObject({ replayed: true, response });
      else await expect(result).rejects.toMatchObject({ code: "invalid_api_key", httpStatus: 401 });
    } finally { await api.releaseAiApiIngressAdmission(ingress.id); }
    expect(provider.complete).not.toHaveBeenCalled();
    expect(await primary.aiApiWallet.findUniqueOrThrow({ where: { id: "fixture-wallet" } })).toEqual(before);
    expect(await primary.aiApiLedgerEntry.count()).toBe(0);
    expect(await primary.aiApiDailyUsage.count()).toBe(0);
    expect(await primary.aiApiKeyDailyUsage.count()).toBe(0);
    expect((await primary.aiApiIngressLease.findUniqueOrThrow({ where: { id: ingress.id } })).releasedAt).not.toBeNull();
  });
  it("executes the actual SQL checkpoint against the generated schema for an active owner", async () => {
    await expect(mark("fixture-request")).resolves.toBeUndefined();
    expect((await primary.aiApiRequest.findUniqueOrThrow({ where: { id: "fixture-request" } })).status).toBe("DISPATCHING");
    expect((await primary.$queryRaw<Array<{ system: string }>>`SELECT system_identifier::text AS system FROM pg_control_system()`)[0].system).toBe(initialSystemIdentifier);
  });
  it.each(["key", "wallet", "owner"])("retries a stale SERIALIZABLE snapshot and vetoes concurrent %s suspension", async (kind) => {
    const locked = barrier(); const release = barrier();
    const mutation = writer.$transaction(async (tx) => {
      if (kind === "key") await tx.aiApiKey.update({ where: { id: "fixture-key" }, data: { status: "REVOKED" } });
      if (kind === "wallet") await tx.aiApiWallet.update({ where: { id: "fixture-wallet" }, data: { isFrozen: true } });
      if (kind === "owner") await tx.user.update({ where: { id: "fixture-user" }, data: { isActive: false } });
      locked.resolve(); await release.promise;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    await locked.promise;
    const dispatched = mark("fixture-request").then(() => ({ ok: true, error: undefined }), (error: unknown) => ({ ok: false, error }));
    try {
      const end = Date.now() + 8_000; let waiting = false;
      while (Date.now() < end) {
        const rows = await observer.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = 'tenant_authority_fixture' AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
        if (rows[0].count > 0) { waiting = true; break; } await delay(20);
      }
      expect(waiting).toBe(true);
    } finally { release.resolve(); }
    await mutation;
    const result = await dispatched;
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "invalid_api_key", requestStatus: "RESERVED" });
    expect((await primary.aiApiRequest.findUniqueOrThrow({ where: { id: "fixture-request" } })).status).toBe("RESERVED");
    expect((await primary.aiApiWallet.findUniqueOrThrow({ where: { id: "fixture-wallet" } })).reservedMicros).toBe(1n);
  }, 20_000);
});
