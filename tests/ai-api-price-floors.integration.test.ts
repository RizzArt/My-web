import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WORKSPACE = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION_NAME = "20261022120000_ai_api_request_price_floors";
const MIGRATION = join(WORKSPACE, "prisma/migrations", MIGRATION_NAME, "migration.sql");
const PG_BIN = "/usr/lib/postgresql/16/bin";
const PRISMA = join(WORKSPACE, "node_modules/prisma/build/index.js");
const ENGINE = join(WORKSPACE, "node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x");
const MODEL = "ai-model-griphub-minimax-m3";
const V1 = "ai-price-griphub-minimax-m3-v1";
const V2 = "ai-price-griphub-minimax-m3-v2";
// Execute these real, unmodified migrations on a synthetic legacy User table.
// Unrelated store/payment migrations are intentionally outside this fixture.
const PREVIOUS = [
  "20261004000000_ai_studio",
  "20261011000000_add_sekai_gateway",
  "20261014060000_ai_api_reseller",
  "20261015010000_ai_api_customer_console_hardening",
  "20261019010000_ai_api_response_replay",
  "20261021020000_ai_api_legacy_integrity_index",
  "20261021220000_add_griphub_studio_disabled",
  "20261021230000_add_griphub_ai_api_disabled",
];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No disposable TCP port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function put(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe.sequential("AI API per-request price floors (disposable PostgreSQL 16)", () => {
  let root = "";
  let data = "";
  let project = "";
  let baseUrl = "";
  let port = 0;
  let nextDatabase = 0;
  let env: NodeJS.ProcessEnv;

  function run(command: string, args: string[], input?: string, extraEnv: NodeJS.ProcessEnv = {}) {
    return spawnSync(command, args, {
      cwd: root,
      env: { ...env, ...extraEnv },
      input,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  }

  function checked(result: ReturnType<typeof run>) {
    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return result.stdout.trim();
  }

  function sqlResult(url: string, sql: string) {
    // Never accept an inherited DATABASE_URL, PGHOST, service file or provider URL.
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe(String(port));
    expect(parsed.search).toBe("");
    expect(parsed.pathname).toMatch(/^\/(postgres|floors_[a-z0-9_]+)$/);
    return run(join(PG_BIN, "psql"), [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], sql);
  }

  const sql = (url: string, text: string) => checked(sqlResult(url, text));
  const rows = (url: string, query: string) => JSON.parse(sql(url,
    `SELECT COALESCE(json_agg(r), '[]'::json) FROM (${query}) r;`));

  function clone() {
    const name = `floors_case_${++nextDatabase}`;
    sql(`${baseUrl}/postgres`, `CREATE DATABASE "${name}" TEMPLATE floors_baseline;`);
    return `${baseUrl}/${name}`;
  }

  function deploy(url: string) {
    expect(new URL(url).hostname).toBe("127.0.0.1");
    expect(new URL(url).port).toBe(String(port));
    expect(new URL(url).pathname).toMatch(/^\/floors_[a-z0-9_]+$/);
    const result = run(process.execPath, [PRISMA, "migrate", "deploy", "--schema", join(project, "schema.prisma")],
      undefined, { PRICE_FLOORS_TEST_DATABASE_URL: url });
    checked(result);
    return result.stdout;
  }

  function migrationText() {
    expect(existsSync(MIGRATION), "The additive request-price-floor migration must exist").toBe(true);
    return readFileSync(MIGRATION, "utf8");
  }

  function stageFloors() {
    put(join(project, "migrations", MIGRATION_NAME, "migration.sql"), migrationText());
  }

  function migratedClone() {
    const url = clone();
    sql(url, migrationText());
    return url;
  }

  function expectSqlFailure(url: string, text: string, expected: RegExp) {
    const result = sqlResult(url, text);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout).not.toBe(0);
    expect(result.stderr).toMatch(expected);
  }

  function probePrice(upstream: string, retail: string) {
    return `INSERT INTO "AiApiPriceVersion" (
      "id", "modelId", "version", "currency", "upstreamInputMicrosPerMillion", "upstreamOutputMicrosPerMillion",
      "retailInputMicrosPerMillion", "retailOutputMicrosPerMillion", "calculatorVersion", "sourceVersion",
      "effectiveFrom", "upstreamMinimumMicros", "retailMinimumMicros"
    ) VALUES ('probe-price', 'probe-model', 1, 'IDR', 1, 1, 2, 2,
      'text-token-floor-v2', 'TEST-ONLY', '2020-01-01', ${upstream}, ${retail});`;
  }

  function addProbeModel(url: string) {
    sql(url, `INSERT INTO "AiApiModel" (
      "id", "publicId", "provider", "upstreamModelId", "displayName", "enabled",
      "maxInputTokens", "maxOutputTokens", "privateBetaMaxOutputTokens", "maxRequestBytes", "updatedAt"
    ) VALUES ('probe-model', 'test-only/probe', 'TEST-ONLY', 'probe', 'Test only', false, 10, 10, 10, 10, CURRENT_TIMESTAMP);`);
  }

  beforeAll(async () => {
    expect(process.getuid?.(), "initdb must run as the current unprivileged user").not.toBe(0);
    expect(existsSync(ENGINE), "Use the installed Prisma engine; never download one").toBe(true);
    // Keep the disposable cluster under the builder-provided writable temp root;
    // never inherit an application DATABASE_URL or project .env.
    root = mkdtempSync(join(tmpdir(), "ai-api-price-floors-"));
    data = join(root, "data");
    project = join(root, "isolated-prisma");
    mkdirSync(join(root, "home"));
    env = {
      PATH: `${dirname(process.execPath)}:${PG_BIN}:/usr/bin:/bin`,
      HOME: join(root, "home"),
      TMPDIR: root,
      LANG: "C.UTF-8",
      CHECKPOINT_DISABLE: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
      PRISMA_SCHEMA_ENGINE_BINARY: ENGINE,
    };
    expect(checked(run(join(PG_BIN, "postgres"), ["--version"]))).toMatch(/PostgreSQL\) 16\./);
    port = await freePort();
    checked(run(join(PG_BIN, "initdb"), ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust"]));
    checked(run(join(PG_BIN, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o",
      `-F -p ${port} -h 127.0.0.1 -c unix_socket_directories=''`, "-w", "start"]));
    baseUrl = `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${port}`;
    expect(sql(`${baseUrl}/postgres`, "SHOW unix_socket_directories;")).toBe("");
    expect(sql(`${baseUrl}/postgres`, "SHOW listen_addresses;")).toBe("127.0.0.1");
    sql(`${baseUrl}/postgres`, "CREATE DATABASE floors_baseline;");
    put(join(project, "schema.prisma"), `datasource db {
  provider = "postgresql"
  url = env("PRICE_FLOORS_TEST_DATABASE_URL")
}
`);
    put(join(project, "migrations/migration_lock.toml"), 'provider = "postgresql"\n');
    put(join(project, "migrations/20260101000000_synthetic_legacy_user/migration.sql"),
      'CREATE TABLE "User" ("id" TEXT PRIMARY KEY);\n');
    for (const name of PREVIOUS) {
      put(join(project, "migrations", name, "migration.sql"),
        readFileSync(join(WORKSPACE, "prisma/migrations", name, "migration.sql"), "utf8"));
    }
    deploy(`${baseUrl}/floors_baseline`);
  }, 60_000);

  afterAll(() => {
    try {
      if (data && existsSync(join(data, "postmaster.pid"))) {
        checked(run(join(PG_BIN, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]));
      }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("adds non-null bigint zero-default minima without repricing historical rows", () => {
    const url = clone();
    const before = rows(url, 'SELECT * FROM "AiApiPriceVersion" ORDER BY "id"');
    stageFloors();
    const firstDeploy = deploy(url);
    const afterFirstDeploy = rows(url, 'SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at');
    const secondDeploy = deploy(url);
    expect(firstDeploy).toContain(MIGRATION_NAME);
    expect(secondDeploy).toContain("No pending migrations to apply");
    expect(rows(url, 'SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at')).toEqual(afterFirstDeploy);
    expect(rows(url, `SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'AiApiPriceVersion'
      AND column_name IN ('upstreamMinimumMicros', 'retailMinimumMicros') ORDER BY column_name`)).toEqual([
      { column_name: "retailMinimumMicros", data_type: "bigint", is_nullable: "NO", column_default: "0" },
      { column_name: "upstreamMinimumMicros", data_type: "bigint", is_nullable: "NO", column_default: "0" },
    ]);
    const after = rows(url, `SELECT * FROM "AiApiPriceVersion" WHERE "id" <> '${V2}' ORDER BY "id"`);
    expect(after).toEqual(before.map((row: Record<string, unknown>) => ({
      ...row, effectiveTo: row.id === V1 ? expect.any(String) : row.effectiveTo,
      upstreamMinimumMicros: 0, retailMinimumMicros: 0,
    })));
  });

  it("allows only the evidence-scoped MiniMax floor and rejects invalid floor rows", () => {
    const url = migratedClone();
    addProbeModel(url);

    expectSqlFailure(url, probePrice("-1", "0"), /AiApiPriceVersion_request_minimum_nonnegative/);
    expectSqlFailure(url, probePrice("1", "0"), /request floor configuration is not evidence-scoped/);
    expectSqlFailure(url, probePrice("1", "2"), /request floor configuration is not evidence-scoped/);

    sql(url, probePrice("0", "0"));
    expect(rows(url, `SELECT "id", "upstreamMinimumMicros", "retailMinimumMicros"
      FROM "AiApiPriceVersion" WHERE "id" = 'probe-price'`)).toEqual([
      { id: "probe-price", upstreamMinimumMicros: 0, retailMinimumMicros: 0 },
    ]);
    expect(rows(url, `SELECT p."modelId", p."upstreamMinimumMicros", p."retailMinimumMicros"
      FROM "AiApiPriceVersion" p
      JOIN "AiApiModel" m ON m."id" = p."modelId"
      WHERE m."provider" = 'GRIPHUB' AND m."upstreamModelId" IN ('gpt-5.6-terra', 'gpt-5.6-sol')
      ORDER BY p."modelId"`)).toEqual([
      { modelId: "ai-model-griphub-gpt-56-sol", upstreamMinimumMicros: 0, retailMinimumMicros: 0 },
      { modelId: "ai-model-griphub-gpt-56-terra", upstreamMinimumMicros: 0, retailMinimumMicros: 0 },
    ]);
    expectSqlFailure(url, `UPDATE "AiApiPriceVersion"
      SET "effectiveFrom" = "effectiveFrom" + INTERVAL '1 millisecond'
      WHERE "id" = '${V1}'`, /AI API price history is immutable/);
    expectSqlFailure(url, `UPDATE "AiApiPriceVersion"
      SET "upstreamMinimumMicros" = 3000000, "retailMinimumMicros" = 4500000
      WHERE "id" = '${V1}'`, /AI API price history is immutable/);
    expectSqlFailure(url, `DELETE FROM "AiApiPriceVersion" WHERE "id" = '${V1}'`, /AI API price history is immutable/);
  });

  it("stages MiniMax v2 with one 1.5x retail floor and leaves Griphub unavailable", () => {
    const url = migratedClone();
    expect(rows(url, `SELECT p."id", p."version", p."upstreamMinimumMicros", p."retailMinimumMicros",
      (p."retailInputMicrosPerMillion" * 2 = p."upstreamInputMicrosPerMillion" * 3) AS "inputMarginOnePointFive",
      (p."retailOutputMicrosPerMillion" * 2 = p."upstreamOutputMicrosPerMillion" * 3) AS "outputMarginOnePointFive",
      p."verifiedAt", m."enabled", h."breakerState", h."healthyUntil",
      (SELECT count(*) FROM "AiApiPriceVersion" active_verified
       WHERE active_verified."modelId" = p."modelId"
         AND active_verified."effectiveTo" IS NULL
         AND active_verified."verifiedAt" IS NOT NULL) AS "activeVerifiedPriceCount"
      FROM "AiApiPriceVersion" p
      JOIN "AiApiModel" m ON m."id" = p."modelId"
      JOIN "AiApiProviderHealth" h ON h."modelId" = m."id"
      WHERE p."id" = '${V2}'`)).toEqual([{
      id: V2, version: 2, upstreamMinimumMicros: 3_000_000, retailMinimumMicros: 4_500_000,
      inputMarginOnePointFive: true, outputMarginOnePointFive: true, verifiedAt: null,
      enabled: false, breakerState: "OPEN", healthyUntil: null, activeVerifiedPriceCount: 0,
    }]);
    // Close the synthetic active v2 range first so this probe reaches the
    // floor-scope trigger rather than the independent no-overlap guard.
    sql(url, `UPDATE "AiApiPriceVersion" SET "effectiveTo" = '2099-01-01'
      WHERE "id" = '${V2}';`);
    expectSqlFailure(url, `INSERT INTO "AiApiPriceVersion" (
      "id", "modelId", "version", "currency", "upstreamInputMicrosPerMillion", "upstreamOutputMicrosPerMillion",
      "retailInputMicrosPerMillion", "retailOutputMicrosPerMillion", "calculatorVersion", "sourceVersion",
      "effectiveFrom", "upstreamMinimumMicros", "retailMinimumMicros"
    ) VALUES ('wrong-minimax-floor', '${MODEL}', 3, 'IDR', 150000000, 150000000, 225000000, 225000000,
      'text-token-floor-v2', 'TEST-ONLY', '2099-01-01', 3000001, 4500000);`, /request floor configuration is not evidence-scoped/);
  });
});
