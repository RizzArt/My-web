/* Real PostgreSQL 16 witness: no application DATABASE_URL and no .env loading. */
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  captureSnapshot,
  migrationSource,
  primaryKey,
  validatePreflight,
  validateSnapshot,
  validateSecondNoop,
  validateTransition,
  queryDatabaseIdentity,
  bindCloneIdentity,
  runTransitionWitness,
} from "../deployment/validate-ai-api-migration-transition.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = "/usr/lib/postgresql/16/bin";
const pending = new Set([
  "20261021220000_add_griphub_studio_disabled",
  "20261021230000_add_griphub_ai_api_disabled",
  "20261022120000_ai_api_request_price_floors",
]);

function run(
  command: string,
  args: string[],
  env: Record<string, string>,
  options: { input?: string; cwd?: string; timeout?: number } = {},
) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env,
    input: options.input,
    timeout: options.timeout ?? 90_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} failed before exit: ${result.error.code ?? result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("cannot allocate PostgreSQL test port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function resolvePrismaCli() {
  if (process.env.AI_API_TEST_PRISMA_CLI) return process.env.AI_API_TEST_PRISMA_CLI;
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("prisma/package.json")), "build/index.js");
}

function startBuffered(command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value: string) => { stdout += value; });
  child.stderr.on("data", (value: string) => { stderr += value; });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, done, stdout: () => stdout, stderr: () => stderr };
}

async function waitUntil(check: () => boolean, label: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("AI API shared migration witness (PostgreSQL 16)", () => {
  it.each([
    ["UTC", "2026-10-23T00:00:00.123Z", "deploy"],
    ["Asia/Jakarta", "2026-10-22T17:00:00.123Z", "deploy"],
    ["UTC", "2026-10-23T00:00:00.123Z", "resolve"],
    ["Asia/Jakarta", "2026-10-22T17:00:00.123Z", "resolve"],
  ])("uses real Prisma history and proves atomic S0→S1→S2 in %s [%s; %s baseline]", async (timeZone, expectedUtc, baselineMode) => {
    expect(existsSync(`${bin}/initdb`)).toBe(true);
    const fixture = mkdtempSync(join(tmpdir(), "ai-api-shared-witness-"));
    const data = join(fixture, "data");
    const home = join(fixture, "home");
    const baseline = join(fixture, "baseline-prisma");
    const log = join(fixture, "postgres.log");
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(baseline, { mode: 0o700 });
    mkdirSync(join(baseline, "migrations"), { mode: 0o700 });

    const port = await freePort();
    const role = "digital-store-build";
    const database = "witness";
    const psqlUrl = `postgresql://${encodeURIComponent(role)}@127.0.0.1:${port}/${database}`;
    const url = `${psqlUrl}?schema=public`;
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NO_COLOR: "1",
      DATABASE_URL: url,
    };
    const prismaCli = resolvePrismaCli();
    let started = false;
    const saved = {
      databaseUrl: process.env.DATABASE_URL,
      expectedDatabase: process.env.AI_API_TRANSITION_EXPECTED_DATABASE,
      expectedDatabaseOid: process.env.AI_API_TRANSITION_EXPECTED_DATABASE_OID,
      expectedSchema: process.env.AI_API_TRANSITION_EXPECTED_SCHEMA,
      expectedCluster: process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY,
      expectedSystemIdentifier: process.env.AI_API_TRANSITION_EXPECTED_SYSTEM_IDENTIFIER,
    };

    try {
      run(`${bin}/initdb`, ["-D", data, "-U", role, "-A", "trust", "--no-locale", "-E", "UTF8"], env);
      run(
        `${bin}/pg_ctl`,
        [
          "-D",
          data,
          "-l",
          log,
          "-o",
          `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c TimeZone=${timeZone} -c log_connections=on -c log_statement=none -c log_line_prefix='%p|%a|'`,
          "-w",
          "start",
        ],
        env,
      );
      started = true;
      run(`${bin}/createdb`, ["-h", "127.0.0.1", "-p", String(port), "-U", role, database], env);

      cpSync(join(root, "prisma/schema.prisma"), join(baseline, "schema.prisma"));
      for (const name of readdirSync(join(root, "prisma/migrations")).sort()) {
        if (!pending.has(name)) {
          cpSync(join(root, "prisma/migrations", name), join(baseline, "migrations", name), { recursive: true });
        }
      }
      const psql = (sql: string) => run("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", psqlUrl], env, { input: sql });
      if (baselineMode === "resolve") {
        // Reproduce real Prisma baselining, not a fabricated migration row.
        const baselineName = "20260928000000_baseline_existing_production";
        psql(readFileSync(join(baseline, "migrations", baselineName, "migration.sql"), "utf8"));
        run(process.execPath, [prismaCli, "migrate", "resolve", "--applied", baselineName, "--schema", join(baseline, "schema.prisma")], env, { cwd: baseline });
        const resolved = JSON.parse(psql(`SELECT json_build_object('steps',applied_steps_count,'logs',logs,'sameTime',started_at=finished_at,'rolledBack',rolled_back_at) FROM "_prisma_migrations" WHERE migration_name='${baselineName}';`));
        expect(resolved).toEqual({ steps: 0, logs: "", sameTime: true, rolledBack: null });
      }
      run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", join(baseline, "schema.prisma")], env, {
        cwd: baseline,
        timeout: 180_000,
      });
      psql(`CREATE INDEX "AiApiRequest_legacy_completed_missing_provider_idx"
        ON "AiApiRequest" ("createdAt", "id") INCLUDE ("modelId", "updatedAt")
        WHERE "status" = 'COMPLETED' AND "providerRequestId" IS NULL;`);
      const identity = JSON.parse(psql(
        "SELECT json_build_object('database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'schema',current_schema(),'cluster',current_setting('port') || '|' || pg_postmaster_start_time()::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))::text;",
      ).trim());
      expect(identity).toMatchObject({ database, schema: "public" });

      psql(`UPDATE "StudioModelConfig"
        SET "updatedAt" = TIMESTAMP '2026-10-23 00:00:00.123'
        WHERE "id" = 'studio_gemini_flash_image';`);

      /* 26 MiB source row: a safe witness must hash it inside PostgreSQL. */
      psql(`INSERT INTO "AuditLog" (id, action, "entityType", "entityId", metadata, "createdAt")
        VALUES ('large-protected-witness', 'TEST', 'TEST', 'TEST', jsonb_build_object('blob', repeat('x', 26 * 1024 * 1024)), TIMESTAMP '2026-10-23 00:00:00.123');`);

      process.env.DATABASE_URL = url;
      process.env.AI_API_TRANSITION_EXPECTED_DATABASE = identity.database;
      process.env.AI_API_TRANSITION_EXPECTED_DATABASE_OID = identity.databaseOid;
      process.env.AI_API_TRANSITION_EXPECTED_SCHEMA = identity.schema;
      process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY = identity.cluster;
      process.env.AI_API_TRANSITION_EXPECTED_SYSTEM_IDENTIFIER = identity.systemIdentifier;

      const source = migrationSource(root);
      const verifyFunctionSecurity = (functionName: string) => {
        const clean = captureSnapshot(root);
        const rogueRole = "witness-untrusted-function-owner";
        psql(`CREATE ROLE "${rogueRole}" NOLOGIN;`);
        try {
          psql(`ALTER FUNCTION public.${functionName}() OWNER TO "${rogueRole}";`);
          try {
            const changed = captureSnapshot(root);
            expect(() => validatePreflight(changed, source)).toThrow(/function.*owner|reviewed executable|applied schema .*function/);
            expect(() => validateSecondNoop(clean, changed, source)).toThrow(/function|state|rejected/);
            if (clean.hasFloors) {
              const repeated = captureSnapshot(root);
              expect(() => validateTransition(changed, repeated, source)).toThrow(/function.*owner|reviewed executable|applied schema .*function/);
              expect(() => validateSecondNoop(changed, repeated, source)).toThrow(/function.*owner|reviewed executable|applied schema .*function/);
            }
          } finally {
            psql(`ALTER FUNCTION public.${functionName}() OWNER TO "${role}";`);
          }
          psql(`REVOKE EXECUTE ON FUNCTION public.${functionName}() FROM PUBLIC;`);
          try {
            const changed = captureSnapshot(root);
            expect(() => validatePreflight(changed, source)).toThrow(/function.*ACL|reviewed executable|applied schema .*function/);
            expect(() => validateSecondNoop(clean, changed, source)).toThrow(/function|state|rejected/);
          } finally {
            psql(`GRANT EXECUTE ON FUNCTION public.${functionName}() TO PUBLIC;`);
          }
          psql(`GRANT EXECUTE ON FUNCTION public.${functionName}() TO "${rogueRole}";`);
          try {
            expect(() => validatePreflight(captureSnapshot(root), source)).toThrow(/function.*ACL|reviewed executable|applied schema .*function/);
          } finally {
            psql(`REVOKE EXECUTE ON FUNCTION public.${functionName}() FROM "${rogueRole}";`);
          }
        } finally {
          psql(`DROP ROLE "${rogueRole}";`);
        }
        // NULL ACL and explicit default ACL have the same effective privileges.
        expect(captureSnapshot(root).schema.functions[`${functionName}()`]).toEqual(clean.schema.functions[`${functionName}()`]);
      };
      verifyFunctionSecurity("ai_api_reject_mutation");
      const verifyCollations = () => {
        const clean = captureSnapshot(root);
        // Built-in collations must not bypass the public-collation inventory check.
        psql('ALTER TABLE "User" ALTER COLUMN email TYPE text COLLATE pg_catalog."C";');
        try {
          const changed = captureSnapshot(root);
          expect(() => validatePreflight(changed, source)).toThrow(/column collation|reviewed/);
          expect(() => validateSecondNoop(clean, changed, source)).toThrow(/collation|state|rejected/);
          if (clean.hasFloors) {
            const repeated = captureSnapshot(root);
            expect(() => validateTransition(changed, repeated, source)).toThrow(/column collation|reviewed/);
            expect(() => validateSecondNoop(changed, repeated, source)).toThrow(/column collation|reviewed/);
          }
        } finally {
          psql('ALTER TABLE "User" ALTER COLUMN email TYPE text COLLATE pg_catalog."default";');
        }
        psql("CREATE COLLATION public.witness_ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);");
        try {
          expect(() => captureSnapshot(root)).toThrow(/unreviewed.*collation/);
          psql('ALTER TABLE "User" ALTER COLUMN email TYPE text COLLATE public.witness_ci;');
          try {
            expect(() => captureSnapshot(root)).toThrow(/unreviewed.*collation/);
            psql(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('collation-witness','Probe@example.invalid',CURRENT_TIMESTAMP);`);
            expect(() => psql(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('collation-duplicate','probe@EXAMPLE.INVALID',CURRENT_TIMESTAMP);`)).toThrow(/User_email_key/);
          } finally {
            psql(`DELETE FROM "User" WHERE id IN ('collation-witness','collation-duplicate');
              ALTER TABLE "User" ALTER COLUMN email TYPE text COLLATE pg_catalog."default";`);
          }
        } finally {
          psql('DROP COLLATION public.witness_ci;');
        }
        expect(captureSnapshot(root).schema.columns.User.email).toEqual(clean.schema.columns.User.email);
        if (clean.hasFloors) expect(validateSecondNoop(clean, captureSnapshot(root), source)).toBe(true);
      };
      verifyCollations();
      // Rehearsal path: explicit clone binding, with no inherited transition variables.
      for (const key of ["DATABASE_URL", "AI_API_TRANSITION_EXPECTED_DATABASE", "AI_API_TRANSITION_EXPECTED_DATABASE_OID", "AI_API_TRANSITION_EXPECTED_SCHEMA", "AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY", "AI_API_TRANSITION_EXPECTED_SYSTEM_IDENTIFIER"]) delete process.env[key];
      const explicit = captureSnapshot(root, { databaseUrl: url, expected: identity });
      expect(explicit.identity).toMatchObject(identity);
      expect(process.env.DATABASE_URL).toBeUndefined();
      expect(() => captureSnapshot(root, { databaseUrl: url, expected: { ...identity, databaseOid: "1" } })).toThrow(/database identity mismatch: databaseOid/);
      expect(() => captureSnapshot(root, { databaseUrl: url, expected: { ...identity, schema: undefined } })).toThrow(/database identity mismatch: schema/);
      expect(() => captureSnapshot(root)).toThrow(/DATABASE_URL missing/);
      if (timeZone === "UTC") {
        // Exact rehearsal code path on a same-cluster clone, with no transition env vars.
        const adminUrl = `postgresql://${encodeURIComponent(role)}@127.0.0.1:${port}/postgres`;
        const cloneName = "witness_rehearsal_clone";
        run("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", adminUrl], env, { input: `CREATE DATABASE "${cloneName}" WITH TEMPLATE "${database}" OWNER "${role}";\n` });
        try {
          const cloneUrl = `postgresql://${encodeURIComponent(role)}@127.0.0.1:${port}/${cloneName}?schema=public`;
          const cloneIdentity = queryDatabaseIdentity(cloneUrl);
          expect(cloneIdentity).toMatchObject({ database: cloneName, schema: "public", cluster: identity.cluster, systemIdentifier: identity.systemIdentifier });
          expect(cloneIdentity.databaseOid).not.toBe(identity.databaseOid);
          const binding = bindCloneIdentity(cloneUrl, cloneIdentity, { database: cloneName, cluster: identity.cluster, systemIdentifier: identity.systemIdentifier });
          expect(() => bindCloneIdentity(cloneUrl, cloneIdentity, { database: database, cluster: identity.cluster, systemIdentifier: identity.systemIdentifier })).toThrow(/clone identity/);
          expect(() => bindCloneIdentity(cloneUrl, cloneIdentity, { database: cloneName, cluster: "other", systemIdentifier: identity.systemIdentifier })).toThrow(/clone identity/);
          const migrate = () => run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", join(root, "prisma/schema.prisma")], { ...env, DATABASE_URL: cloneUrl }, { cwd: root, timeout: 180_000 });
          const rehearsal = runTransitionWitness(root, binding, migrate);
          expect(rehearsal.mode).toBe("first");
          expect(rehearsal.s1.identity.database).toBe(cloneName);
          expect(validateSecondNoop(rehearsal.s1, rehearsal.s2, source)).toBe(true);
          for (const key of ["DATABASE_URL", "AI_API_TRANSITION_EXPECTED_DATABASE", "AI_API_TRANSITION_EXPECTED_DATABASE_OID"]) expect(process.env[key]).toBeUndefined();
          // The source database is untouched by the clone rehearsal.
          expect(validatePreflight(captureSnapshot(root, { databaseUrl: url, expected: identity }), source)).toBe("first");
        } finally {
          run("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", adminUrl], env, { input: `DROP DATABASE IF EXISTS "${cloneName}" WITH (FORCE);\n` });
        }
      }
      process.env.DATABASE_URL = url;
      process.env.AI_API_TRANSITION_EXPECTED_DATABASE = identity.database;
      process.env.AI_API_TRANSITION_EXPECTED_DATABASE_OID = identity.databaseOid;
      process.env.AI_API_TRANSITION_EXPECTED_SCHEMA = identity.schema;
      process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY = identity.cluster;
      process.env.AI_API_TRANSITION_EXPECTED_SYSTEM_IDENTIFIER = identity.systemIdentifier;
      if (timeZone === "UTC") {
        process.env.DATABASE_URL = `${psqlUrl}?schema=private`;
        expect(() => captureSnapshot(root)).toThrow(/unsupported DATABASE_URL parameter/);
        process.env.DATABASE_URL = url;
        process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY = "wrong-cluster";
        expect(() => captureSnapshot(root)).toThrow(/database identity mismatch: cluster/);
        process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY = identity.cluster;

        const locker = startBuffered("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", psqlUrl], env);
        let capture: ReturnType<typeof startBuffered> | undefined;
        try {
          locker.child.stdin.write('BEGIN;\nLOCK TABLE "AuditLog" IN ACCESS EXCLUSIVE MODE;\n\\echo LOCKED\n');
          await waitUntil(() => locker.stdout().includes("LOCKED"), "AuditLog lock");
          capture = startBuffered(process.execPath, [join(root, "deployment/validate-ai-api-migration-transition.mjs"), "capture", root], { ...process.env } as Record<string, string>);
          capture.child.stdin.end();
          await waitUntil(() => psql(`SELECT COALESCE((SELECT wait_event_type || E'\\t' || query FROM pg_stat_activity WHERE application_name = 'ai-api-transition-witness' AND pid <> pg_backend_pid()), '');`).includes("Lock\t"), "witness lock wait");
          psql(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('concurrent-witness-user', 'concurrent-witness@example.invalid', CURRENT_TIMESTAMP);`);
          locker.child.stdin.end("COMMIT;\n\\q\n");
          const lockResult = await locker.done;
          expect(lockResult).toEqual({ code: 0, signal: null });
          const captureResult = await capture.done;
          expect(captureResult, capture.stderr()).toEqual({ code: 0, signal: null });
          const atomic = JSON.parse(capture.stdout());
          expect(validateSnapshot(atomic, source)).toBe(atomic);
          expect(atomic.tables.User.some((row: { key: string }) => row.key === primaryKey(["concurrent-witness-user"]))).toBe(false);
          psql(`DELETE FROM "User" WHERE id = 'concurrent-witness-user';`);
        } finally {
          if (locker.child.exitCode === null) locker.child.kill("SIGKILL");
          if (capture && capture.child.exitCode === null) capture.child.kill("SIGKILL");
        }

        const contention = startBuffered("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", psqlUrl], env);
        try {
          contention.child.stdin.write('BEGIN;\nLOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;\n\\echo LOCKED\n');
          await waitUntil(() => contention.stdout().includes("LOCKED"), "User lock");
          expect(() => captureSnapshot(root)).toThrow(/lock timeout|snapshot query exit/);
          contention.child.stdin.end("COMMIT;\n\\q\n");
          expect(await contention.done).toEqual({ code: 0, signal: null });
        } finally {
          if (contention.child.exitCode === null) contention.child.kill("SIGKILL");
        }
      }
      const captureLogOffset = readFileSync(log, "utf8").length;
      const s0 = captureSnapshot(root);
      const captureLog = readFileSync(log, "utf8").slice(captureLogOffset);
      const witnessPids = new Set(
        captureLog
          .split("\n")
          .filter((line) => line.includes("application_name=ai-api-transition-witness"))
          .map((line) => line.split("|", 1)[0])
          .filter(Boolean),
      );
      expect(witnessPids.size, captureLog.slice(-4000)).toBe(1);
      expect(s0.tables.AuditLog.find((row: { key: string }) => row.key === primaryKey(["large-protected-witness"]))?.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(s0)).not.toContain("xxxxxxxxxxxxxxxx");
      expect(s0.identity.timeZone).toBe(timeZone);
      expect(s0.details.StudioModelConfig.find((row: { id: string }) => row.id === "studio_gemini_flash_image")?.updatedAt).toBe(expectedUtc);

      run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", join(root, "prisma/schema.prisma")], env, {
        cwd: root,
        timeout: 180_000,
      });
      const s1 = captureSnapshot(root);
      expect(s1.schema.triggers.AiApiPriceVersion.find((trigger: { name: string }) => trigger.name === "Z_AiApiPriceVersion_floor_scope")).toEqual({
        name: "Z_AiApiPriceVersion_floor_scope",
        enabled: "O",
        function: "public.ai_api_price_floor_guard",
        definition: "CREATE TRIGGER \"Z_AiApiPriceVersion_floor_scope\" BEFORE INSERT OR UPDATE ON public.\"AiApiPriceVersion\" FOR EACH ROW EXECUTE FUNCTION public.ai_api_price_floor_guard()",
      });
      expect(validateTransition(s0, s1, source)).toBe(true);
      expect(s1.identity.databaseRole).toBe(role);
      expect(s1.schema.functions["ai_api_reject_mutation()"].owner).toBe(role);
      expect(s1.schema.functions["ai_api_reject_mutation()"].acl).toEqual([
        { grantee: null, grantor: role, privilege: "EXECUTE", grantable: false },
        { grantee: role, grantor: role, privilege: "EXECUTE", grantable: false },
      ]);
      expect(s1.schema.columns.User.email.collation).toEqual({ schema: "pg_catalog", name: "default" });
      expect(s1.schema.columns.AiApiPriceVersion.upstreamMinimumMicros.collation).toBeNull();
      expect(s1.schema.environment.collations).toEqual([]);
      expect(s1.schema.primaryKeys.User).toEqual(["id"]);
      expect(s1.schema.relations.User).toMatchObject({ owner: role, rowSecurity: false, forceRowSecurity: false, persistence: "p", replicaIdentity: "d" });
      expect(s1.schema.relations._prisma_migrations).toMatchObject({ owner: role, rowSecurity: false, forceRowSecurity: false, persistence: "p" });
      expect(s1.schema.policies.User).toEqual([]);
      expect(s1.schema.objects).toContainEqual(expect.objectContaining({ name: "User", kind: "r" }));
      expect(s1.schema.columns.AiApiPriceVersion.upstreamMinimumMicros.type).toBe("bigint");
      expect(s1.schema.columns.AiApiPriceVersion.retailMinimumMicros.type).toBe("bigint");
      for (const table of ["StudioModelConfig", "AiApiModel", "AiApiPriceVersion", "AiApiProviderHealth"] as const) {
        for (const row of s1.details[table]) {
          for (const [key, value] of Object.entries(row)) {
            if (/At$/.test(key) && value !== null) expect(value).toMatch(/\.\d{3}Z$/);
          }
        }
      }
      expect(s1.details.AiApiModel[0].maxInputTokens).toBeTypeOf("string");

      run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", join(root, "prisma/schema.prisma")], env, {
        cwd: root,
        timeout: 180_000,
      });
      const s2 = captureSnapshot(root);
      expect(validateSecondNoop(s1, s2, source)).toBe(true);
      verifyFunctionSecurity("ai_api_reject_mutation");
      verifyFunctionSecurity("ai_api_price_floor_guard");
      verifyCollations();

      psql('ALTER TABLE "User" ENABLE ROW LEVEL SECURITY; ALTER TABLE "User" FORCE ROW LEVEL SECURITY; CREATE POLICY "witness_hide_user" ON "User" USING (false);');
      expect(() => captureSnapshot(root)).toThrow(/row-level security|snapshot query exit/);
      psql('DROP POLICY "witness_hide_user" ON "User"; ALTER TABLE "User" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;');

      psql('ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "_prisma_migrations" FORCE ROW LEVEL SECURITY; CREATE POLICY "witness_hide_migration" ON "_prisma_migrations" USING (false);');
      expect(() => captureSnapshot(root)).toThrow(/row-level security|snapshot query exit/);
      psql('DROP POLICY "witness_hide_migration" ON "_prisma_migrations"; ALTER TABLE "_prisma_migrations" NO FORCE ROW LEVEL SECURITY; ALTER TABLE "_prisma_migrations" DISABLE ROW LEVEL SECURITY;');

      psql('ALTER TABLE "PasswordResetRequest" SET UNLOGGED;');
      const withUnlogged = captureSnapshot(root);
      expect(withUnlogged.schema.relations.PasswordResetRequest.persistence).toBe("u");
      expect(() => validateSecondNoop(s2, withUnlogged, source)).toThrow(/schema|database state|rejected/);
      psql('ALTER TABLE "PasswordResetRequest" SET LOGGED;');

      // Unreviewed views/sequences now fail closed at capture time (their row types
      // are unreviewed user-defined types), before any comparison is attempted.
      psql('CREATE VIEW "WitnessUnexpectedView" AS SELECT 1 AS value;');
      expect(() => captureSnapshot(root)).toThrow(/unreviewed user-defined type|schema object|rejected/);
      psql('DROP VIEW "WitnessUnexpectedView";');

      psql('CREATE SEQUENCE "WitnessUnexpectedSequence";');
      expect(() => captureSnapshot(root)).toThrow(/unreviewed user-defined type|schema object|rejected/);
      psql('DROP SEQUENCE "WitnessUnexpectedSequence";');

      const restored = captureSnapshot(root);
      expect(validateSecondNoop(s2, restored, source)).toBe(true);
      expect(validatePreflight(restored, source)).toBe("retry");

      psql(`CREATE FUNCTION rewrite_email_hash() RETURNS trigger AS $$ BEGIN NEW."emailHash" := 'x'; RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER rewrite_email_hash BEFORE INSERT OR UPDATE ON "PasswordResetRequest" FOR EACH ROW EXECUTE FUNCTION rewrite_email_hash();`);
      const rogueRetry = captureSnapshot(root);
      const rogueRetryAgain = captureSnapshot(root);
      expect(() => validatePreflight(rogueRetry, source)).toThrow(/reviewed|rejected/);
      expect(() => validateTransition(rogueRetry, rogueRetryAgain, source)).toThrow(/reviewed|rejected/);
      expect(() => validateSecondNoop(rogueRetry, rogueRetryAgain, source)).toThrow(/reviewed|rejected/);
      psql('DROP TRIGGER rewrite_email_hash ON "PasswordResetRequest"; DROP FUNCTION rewrite_email_hash();');

      psql('ALTER TABLE "AiApiLedgerEntry" DISABLE TRIGGER "AiApiLedgerEntry_immutable";');
      expect(() => validatePreflight(captureSnapshot(root), source)).toThrow(/reviewed|rejected/);
      psql('ALTER TABLE "AiApiLedgerEntry" ENABLE TRIGGER "AiApiLedgerEntry_immutable";');

      psql(`CREATE RULE rewrite_user AS ON INSERT TO "User" DO INSTEAD NOTHING;`);
      expect(() => validatePreflight(captureSnapshot(root), source)).toThrow(/rewrite rule|rejected/);
      psql('DROP RULE rewrite_user ON "User";');

      // Reviewer-1 search_path shadow: an exact-type overload in another schema must
      // neither hide protected-row changes nor be accepted as a reviewed state.
      psql(`INSERT INTO "User" (id, email, "updatedAt") VALUES ('shadow-victim', 'victim@example.invalid', TIMESTAMP '2026-10-01 00:00:00');`);
      const beforeShadow = captureSnapshot(root);
      psql(`CREATE SCHEMA shadow;
        CREATE FUNCTION shadow.to_jsonb(public."User") RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('id', ($1).id) $$;
        ALTER DATABASE "${database}" SET search_path = public, shadow;`);
      psql(`UPDATE "User" SET role = 'ADMIN', email = 'attacker@example.invalid', "passwordHash" = 'attacker-chosen' WHERE id = 'shadow-victim';`);
      expect(() => captureSnapshot(root)).toThrow(/schema|search_path|rejected/);
      psql(`ALTER DATABASE "${database}" RESET search_path;`);
      expect(() => captureSnapshot(root)).toThrow(/schema|rejected/);
      psql(`DROP SCHEMA shadow CASCADE;`);
      // Even with every shadow removed, the hidden mutation is now visible.
      expect(() => validateSecondNoop(beforeShadow, captureSnapshot(root), source)).toThrow(/mutated|database state|rejected/);
      psql(`ALTER ROLE "${role}" SET search_path = public;`);
      expect(() => captureSnapshot(root)).toThrow(/search_path|role setting|rejected/);
      psql(`ALTER ROLE "${role}" RESET search_path;`);
      psql(`CREATE FUNCTION public.shadow_eq(text, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
        CREATE OPERATOR public.= (LEFTARG = text, RIGHTARG = text, FUNCTION = public.shadow_eq);`);
      expect(() => captureSnapshot(root)).toThrow(/operator|reviewed|rejected/);
      psql(`DROP OPERATOR public.= (text, text); DROP FUNCTION public.shadow_eq(text, text);`);
      psql(`GRANT UPDATE ("passwordHash") ON "User" TO PUBLIC;`);
      const columnGrant = captureSnapshot(root);
      psql(`REVOKE UPDATE ("passwordHash") ON "User" FROM PUBLIC;`);
      expect(() => validateSecondNoop(captureSnapshot(root), { ...columnGrant, capturedAt: new Date(Date.now() + 60_000).toISOString() }, source)).toThrow(/schema|database state|rejected/);
      psql(`DELETE FROM "User" WHERE id = 'shadow-victim';`);

      // The reviewed floor guard must reject any later nonzero-floor MiniMax version,
      // even one that copies the approved floor and calculator but changes rates/source.
      expect(() => psql(`BEGIN;
        UPDATE "AiApiPriceVersion" SET "effectiveTo" = "effectiveFrom" + INTERVAL '1 day' WHERE "id" = 'ai-price-griphub-minimax-m3-v2';
        INSERT INTO "AiApiPriceVersion" ("id","modelId","version","currency","upstreamInputMicrosPerMillion","upstreamOutputMicrosPerMillion","retailInputMicrosPerMillion","retailOutputMicrosPerMillion","upstreamMinimumMicros","retailMinimumMicros","calculatorVersion","sourceVersion","effectiveFrom")
        SELECT 'rogue-floor-v3','ai-model-griphub-minimax-m3',3,'IDR',1,2,3,4,3000000,4500000,'text-token-floor-v2','UNREVIEWED-SOURCE',"effectiveTo" FROM "AiApiPriceVersion" WHERE "id" = 'ai-price-griphub-minimax-m3-v2';
        COMMIT;`)).toThrow(/request floor configuration is not evidence-scoped/);
      expect(psql("SELECT count(*)::text FROM \"AiApiPriceVersion\" WHERE \"id\" = 'rogue-floor-v3';").trim()).toBe("0");
      expect(psql("SELECT (\"effectiveTo\" IS NULL)::text FROM \"AiApiPriceVersion\" WHERE \"id\" = 'ai-price-griphub-minimax-m3-v2';").trim()).toBe("true");
      expect(validateSecondNoop(s2, captureSnapshot(root), source)).toBe(true);

      psql("INSERT INTO \"AuditLog\" (id,action,\"entityType\",\"entityId\",\"createdAt\") VALUES ('witness-unexpected','TEST','TEST','TEST',CURRENT_TIMESTAMP);");
      const bad = captureSnapshot(root);
      expect(() => validateSecondNoop(s2, bad, source)).toThrow(/exact additions|database state|rejected/);
      psql("DELETE FROM \"AuditLog\" WHERE id = 'witness-unexpected';");

      const adminUrl = `postgresql://${encodeURIComponent(role)}@127.0.0.1:${port}/postgres`;
      run("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", adminUrl], env, { input: `ALTER DATABASE "${database}" RENAME TO "${database}_old";\nCREATE DATABASE "${database}" WITH TEMPLATE "${database}_old" OWNER "${role}";\nDROP DATABASE "${database}_old";\n` });
      expect(() => captureSnapshot(root)).toThrow(/database identity mismatch: databaseOid/);
      const replacementOid = psql("SELECT oid::text FROM pg_database WHERE datname=current_database();").trim();
      expect(replacementOid).not.toBe(identity.databaseOid);
      process.env.AI_API_TRANSITION_EXPECTED_DATABASE_OID = replacementOid;
      const replacement = captureSnapshot(root);
      expect(() => validateSecondNoop(s2, replacement, source)).toThrow(/identity|database state|rejected/);
    } finally {
      if (saved.databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.databaseUrl;
      if (saved.expectedDatabase === undefined) delete process.env.AI_API_TRANSITION_EXPECTED_DATABASE;
      else process.env.AI_API_TRANSITION_EXPECTED_DATABASE = saved.expectedDatabase;
      if (saved.expectedDatabaseOid === undefined) delete process.env.AI_API_TRANSITION_EXPECTED_DATABASE_OID;
      else process.env.AI_API_TRANSITION_EXPECTED_DATABASE_OID = saved.expectedDatabaseOid;
      if (saved.expectedSchema === undefined) delete process.env.AI_API_TRANSITION_EXPECTED_SCHEMA;
      else process.env.AI_API_TRANSITION_EXPECTED_SCHEMA = saved.expectedSchema;
      if (saved.expectedCluster === undefined) delete process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY;
      else process.env.AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY = saved.expectedCluster;
      if (saved.expectedSystemIdentifier === undefined) delete process.env.AI_API_TRANSITION_EXPECTED_SYSTEM_IDENTIFIER;
      else process.env.AI_API_TRANSITION_EXPECTED_SYSTEM_IDENTIFIER = saved.expectedSystemIdentifier;

      if (started) {
        const stopped = spawnSync(`${bin}/pg_ctl`, ["-D", data, "-m", "immediate", "-w", "stop"], {
          encoding: "utf8",
          env,
          timeout: 30_000,
        });
        expect(stopped.error).toBeUndefined();
        expect(stopped.status).toBe(0);
      }
      rmSync(fixture, { recursive: true, force: true });
      expect(existsSync(fixture)).toBe(false);
    }
  }, 300_000);
});
