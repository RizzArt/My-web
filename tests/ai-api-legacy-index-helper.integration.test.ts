import { chmodSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const INITDB = "/usr/lib/postgresql/16/bin/initdb";
const PG_CTL = "/usr/lib/postgresql/16/bin/pg_ctl";
const HELPER = new URL("../deployment/ensure-ai-api-legacy-integrity-index.mjs", import.meta.url).pathname;
const RELEASE_SENTINEL = "/home/harnet/releases/legacy-index-integration-fixture";
const INDEX_NAME = "AiApiRequest_legacy_completed_missing_provider_idx";

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { encoding: "utf8", env, timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).slice(-2000)}`);
  return result.stdout.trim();
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function helperEnv(url: string, database: string, clusterIdentity: string, home: string, schema = "public") {
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    TMPDIR: join(home, "..", "private-tmp"),
    AI_API_LEGACY_INDEX_DATABASE_URL: url,
    AI_API_LEGACY_INDEX_EXPECTED_DATABASE: database,
    AI_API_LEGACY_INDEX_EXPECTED_SCHEMA: schema,
    AI_API_LEGACY_INDEX_EXPECTED_CLUSTER_IDENTITY: clusterIdentity,
  };
}

describe.sequential("Legacy Integrity concurrent-index helper", () => {
  let root = "";
  let data = "";
  let home = "";
  let port = 0;
  let url = "";
  let otherUrl = "";
  let emptyUrl = "";
  let clusterIdentity = "";

  const psql = (databaseUrl: string, sql: string) => run("/usr/bin/psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-tAc", sql]);
  const invoke = (databaseUrl = url, expectedDatabase = "legacy_helper_test", expectedCluster = clusterIdentity, expectedSchema = "public") => spawnSync(process.execPath, [HELPER, RELEASE_SENTINEL], {
    encoding: "utf8",
    env: helperEnv(databaseUrl, expectedDatabase, expectedCluster, home, expectedSchema),
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "legacy-index-helper-"));
    data = join(root, "data");
    home = join(root, "home");
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(join(root, "private-tmp"), { mode: 0o700 });
    port = await freePort();
    run(INITDB, ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
    run(PG_CTL, ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -p ${port} -h 127.0.0.1 -c unix_socket_directories=''`, "-w", "start"]);
    const base = `postgresql://${process.env.USER || "ubuntu"}@127.0.0.1:${port}`;
    psql(`${base}/postgres`, 'CREATE DATABASE legacy_helper_test');
    psql(`${base}/postgres`, 'CREATE DATABASE legacy_helper_other');
    psql(`${base}/postgres`, 'CREATE DATABASE legacy_helper_empty');
    url = `${base}/legacy_helper_test`;
    otherUrl = `${base}/legacy_helper_other`;
    emptyUrl = `${base}/legacy_helper_empty`;
    const schema = `
      CREATE TYPE "AiApiRequestStatus" AS ENUM ('COMPLETED', 'FAILED_RELEASED');
      CREATE TABLE "AiApiModel" ("id" text PRIMARY KEY, "publicId" text NOT NULL);
      CREATE TABLE "AiApiRequest" (
        "id" text PRIMARY KEY,
        "status" "AiApiRequestStatus" NOT NULL,
        "providerRequestId" text,
        "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL,
        "modelId" text NOT NULL REFERENCES "AiApiModel"("id")
      );`;
    psql(url, schema);
    psql(otherUrl, schema);
    clusterIdentity = psql(url, "SELECT current_setting('port') || '|' || pg_postmaster_start_time()::text");
  }, 30_000);

  afterAll(() => {
    if (data) spawnSync(PG_CTL, ["-D", data, "-m", "immediate", "-w", "stop"], { encoding: "utf8", timeout: 15_000 });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("creates the exact partial index and is idempotent", () => {
    const first = invoke();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("AI_API_LEGACY_INTEGRITY_INDEX_OK");
    const definition = psql(url, `SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid = '"${INDEX_NAME}"'::regclass`);
    expect(definition).toContain('CREATE INDEX');
    expect(definition).toContain('("createdAt", id) INCLUDE ("modelId", "updatedAt")');
    expect(definition).toContain('"providerRequestId" IS NULL');
    const second = invoke();
    expect(second.status, second.stderr).toBe(0);
    expect(psql(url, `SELECT count(*) FROM pg_class WHERE relname = '${INDEX_NAME}'`)).toBe("1");
    expect(psql(otherUrl, `SELECT count(*) FROM pg_class WHERE relname = '${INDEX_NAME}'`)).toBe("0");
  });

  it("uses private TMPDIR with a non-writable HOME and cleans credentials", () => {
    const lockedHome = join(root, "locked-home");
    mkdirSync(lockedHome, { mode: 0o555 });
    chmodSync(lockedHome, 0o555); // Pin the fixture independently of the runner's umask.
    const result = spawnSync(process.execPath, [HELPER, RELEASE_SENTINEL], {
      encoding: "utf8",
      env: helperEnv(url, "legacy_helper_test", clusterIdentity, lockedHome),
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("AI_API_LEGACY_INTEGRITY_INDEX_OK");
    expect(statSync(lockedHome).mode & 0o777).toBe(0o555);
    expect(readdirSync(lockedHome)).toEqual([]);
    expect(readdirSync(join(root, "private-tmp"))).toEqual([]);
  });

  it("fails closed when TMPDIR is missing instead of falling back to HOME", () => {
    const missingTemp = join(root, "missing-private-tmp");
    const beforeHome = readdirSync(home);
    const result = spawnSync(process.execPath, [HELPER, RELEASE_SENTINEL], {
      encoding: "utf8",
      env: { ...helperEnv(url, "legacy_helper_test", clusterIdentity, home), TMPDIR: missingTemp },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ENOENT");
    expect(readdirSync(home)).toEqual(beforeHome);
    expect(readdirSync(join(root, "private-tmp"))).toEqual([]);
  });

  it("rejects routing query parameters and a mismatched expected database before DDL", () => {
    psql(url, `DROP INDEX "${INDEX_NAME}"`);
    const routed = invoke(`${url}?dbname=legacy_helper_other`);
    expect(routed.status).not.toBe(0);
    expect(routed.stderr).toContain("parameter routing database tidak didukung");
    expect(psql(url, `SELECT count(*) FROM pg_class WHERE relname = '${INDEX_NAME}'`)).toBe("0");
    expect(psql(otherUrl, `SELECT count(*) FROM pg_class WHERE relname = '${INDEX_NAME}'`)).toBe("0");

    const credentialUrl = new URL(url);
    credentialUrl.password = "integration-fixture-password-not-a-secret";
    const mismatched = invoke(credentialUrl.toString(), "legacy_helper_other");
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("database target index tidak sesuai");
    expect(mismatched.stderr + mismatched.stdout).not.toContain(credentialUrl.password);
    expect(readdirSync(join(root, "private-tmp"))).toEqual([]);
    expect(psql(url, `SELECT count(*) FROM pg_class WHERE relname = '${INDEX_NAME}'`)).toBe("0");
  });

  it("fails closed on a broader predicate instead of accepting or replacing it", () => {
    psql(url, `CREATE INDEX "${INDEX_NAME}" ON "AiApiRequest" ("createdAt", "id") INCLUDE ("modelId", "updatedAt") WHERE ("status" = 'COMPLETED' AND "providerRequestId" IS NULL) OR "status" = 'FAILED_RELEASED'`);
    const result = invoke();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("predicate");
    expect(psql(url, `SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid = '"${INDEX_NAME}"'::regclass`)).toContain("FAILED_RELEASED");
    psql(url, `DROP INDEX "${INDEX_NAME}"`);
  });

  it("recovers a matching invalid concurrent index and leaves it valid", () => {
    expect(invoke().status).toBe(0);
    psql(url, `UPDATE pg_index SET indisvalid = false WHERE indexrelid = '"${INDEX_NAME}"'::regclass`);
    expect(psql(url, `SELECT indisvalid FROM pg_index WHERE indexrelid = '"${INDEX_NAME}"'::regclass`)).toBe("f");
    const result = invoke();
    expect(result.status, result.stderr).toBe(0);
    expect(psql(url, `SELECT indisvalid FROM pg_index WHERE indexrelid = '"${INDEX_NAME}"'::regclass`)).toBe("t");
  });
});
