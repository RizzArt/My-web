/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial JSON fixtures */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SNAPSHOT_BYTES, PENDING_MIGRATIONS, PROTECTED_TABLES, SCHEMA_TABLES, SNAPSHOT_FORMAT, hash, reviewedExecutableSchema, migrationSource, primaryKey, validatePreflight, validateSecondNoop, validateSnapshot, validateTransition } from "../deployment/validate-ai-api-migration-transition.mjs";

const root = new URL("..", import.meta.url).pathname;
const source = migrationSource(root);
const t0 = "2026-10-23T00:00:00.000Z", t1 = "2026-10-23T00:00:10.000Z", t2 = "2026-10-23T00:00:20.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const digest = (value: unknown) => hash(JSON.stringify(value));
const migrations = (names: string[]) => names.map((migration_name, i) => ({ id: `migration-${i}`, migration_name, checksum: source[migration_name], started_at: t0, finished_at: t0, rolled_back_at: null, applied_steps_count: 1, logs: null }));
const baseline = Object.keys(source).filter((name) => !PENDING_MIGRATIONS.includes(name));
function schemaWitness() {
  const witness: any = {
    primaryKeys: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, ["id"]])),
    columns: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, { id: { position: 1, type: "text", collation: { schema: "pg_catalog", name: "default" }, notNull: true, default: null, identity: "", generated: "" } }])),
    constraints: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, []])),
    indexes: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, []])),
    triggers: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, []])),
    relations: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, { owner: "owner", acl: null, rowSecurity: false, forceRowSecurity: false, persistence: "p", replicaIdentity: "d" }])),
    policies: Object.fromEntries(SCHEMA_TABLES.map((table) => [table, []])),
    objects: [...PROTECTED_TABLES, "_prisma_migrations"].sort().map((name) => ({ name, kind: "r", owner: "owner", acl: null, definition: null })),
    rules: [],
    eventTriggers: [],
    extensions: ["plpgsql"],
    columnAcls: [],
    environment: { namespaces: [{ name: "public", owner: "owner", acl: null }], roleSettings: [], operators: [], casts: [], types: [], collations: [], sessionSearchPath: '"$user", public' },
    functions: {},
    enums: {},
  };
  // Baseline executable schema is the reviewed pre-floor set derived from migration bytes.
  const reviewed = reviewedExecutableSchema(false, "owner");
  witness.functions = reviewed.functions;
  witness.triggers = reviewed.triggers;
  return witness;
}
const floorMigrationSql = readFileSync(new URL("../prisma/migrations/20261022120000_ai_api_request_price_floors/migration.sql", import.meta.url), "utf8");
function migrationFunctionDigest(name: string) {
  const match = floorMigrationSql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(\\) RETURNS trigger AS \\$\\$([\\s\\S]*?)\\$\\$ LANGUAGE plpgsql;`));
  if (!match) throw new Error(`missing migration function: ${name}`);
  return createHash("sha256").update(match[1], "utf8").digest("hex");
}
function applyExpectedSchemaTransition(schema: any) {
  schema.columns.AiApiPriceVersion.upstreamMinimumMicros = { position: 2, type: "bigint", collation: null, notNull: true, default: "0", identity: "", generated: "" };
  schema.columns.AiApiPriceVersion.retailMinimumMicros = { position: 3, type: "bigint", collation: null, notNull: true, default: "0", identity: "", generated: "" };
  schema.constraints.AiApiPriceVersion.push(
    { name: "AiApiPriceVersion_request_minimum_nonnegative", type: "c", validated: true, definition: "CHECK (\"upstreamMinimumMicros\" >= 0 AND \"retailMinimumMicros\" >= 0)" },
    { name: "AiApiPriceVersion_request_minimum_pair", type: "c", validated: true, definition: "CHECK (\"upstreamMinimumMicros\" = 0 AND \"retailMinimumMicros\" = 0 OR \"upstreamMinimumMicros\" > 0 AND \"retailMinimumMicros\" > 0)" },
  );
  schema.triggers.AiApiPriceVersion.push({ name: "Z_AiApiPriceVersion_floor_scope", enabled: "O", function: "public.ai_api_price_floor_guard", definition: "CREATE TRIGGER \"Z_AiApiPriceVersion_floor_scope\" BEFORE INSERT OR UPDATE ON public.\"AiApiPriceVersion\" FOR EACH ROW EXECUTE FUNCTION public.ai_api_price_floor_guard()" });
  const metadata = reviewedExecutableSchema(true, "owner").functions["ai_api_price_floor_guard()"];
  schema.functions["ai_api_price_guard_mutation()"] = { ...metadata, sourceDigest: migrationFunctionDigest("ai_api_price_guard_mutation") };
  schema.functions["ai_api_price_floor_guard()"] = { ...metadata, sourceDigest: migrationFunctionDigest("ai_api_price_floor_guard") };
}
function finalize(snapshot: any) {
  for (const table of PROTECTED_TABLES) if (snapshot.details[table]) snapshot.tables[table] = snapshot.details[table].map((row: any) => ({ key: primaryKey([row.id]), digest: digest(row) }));
  for (const table of PROTECTED_TABLES) if (!["StudioModelConfig", "AiApiModel", "AiApiPriceVersion", "AiApiProviderHealth"].includes(table)) delete snapshot.details[table];
  return snapshot;
}
function base() {
  const details: Record<string, any[]> = Object.fromEntries(PROTECTED_TABLES.map((table) => [table, []]));
  details.AiApiModel = [{ id: "sekai", publicId: "sekai/a", provider: "SEKAI", upstreamModelId: "a", enabled: true, maxInputTokens: "1", maxOutputTokens: "2", privateBetaMaxOutputTokens: "2", maxRequestBytes: "3", maxExecutionSeconds: "120", createdAt: t0, updatedAt: t0 }];
  details.AiApiProviderHealth = [{ id: "sekai-health", modelId: "sekai", breakerState: "OPEN", healthyUntil: null, consecutiveFailures: "0", lastSuccessAt: null, safeReasonCode: "baseline", updatedAt: t0 }];
  details.AiApiPriceVersion = [{ id: "sekai-price", modelId: "sekai", version: "1", currency: "IDR", upstreamInputMicrosPerMillion: "9007199254740992", upstreamOutputMicrosPerMillion: "9007199254740993", retailInputMicrosPerMillion: "2", retailOutputMicrosPerMillion: "3", calculatorVersion: "legacy", sourceVersion: "legacy", verifiedAt: t0, effectiveFrom: t0, effectiveTo: null, createdAt: t0 }];
  details.StudioModelConfig = [{ id: "studio-sekai", provider: "SEKAI", model: "image", displayName: "SEKAI", isEnabled: false, creditCostPerImage: "1", supportsReferenceImage: false, supportedAspectRatios: ["1:1"], createdAt: t0, updatedAt: t0 }];
  for (const table of PROTECTED_TABLES.filter((table) => !["StudioModelConfig", "AiApiModel", "AiApiPriceVersion", "AiApiProviderHealth"].includes(table))) details[table] = [{ id: `${table}-row`, value: "preserved" }];
  return finalize({ format: SNAPSHOT_FORMAT, capturedAt: t0, identity: { database: "disposable", databaseOid: "16384", databaseRole: "owner", schema: "public", cluster: "5432|test", systemIdentifier: "7700167842034037046", source: "local-libpq", timeZone: "UTC" }, source, hasFloors: false, migrations: migrations(baseline), tables: {}, details, references: [{ id: "AiApiRequest-row", modelId: "sekai", priceVersionId: "sekai-price" }], schema: schemaWitness() });
}
function price(id: string, modelId: string, version: string, upstream: string, retail: string, calculatorVersion: string, sourceVersion: string, verifiedAt: string | null, effectiveFrom: string, effectiveTo: string | null, upFloor = "0", retailFloor = "0") {
  return { id, modelId, version, currency: "IDR", upstreamInputMicrosPerMillion: upstream, upstreamOutputMicrosPerMillion: upstream, retailInputMicrosPerMillion: retail, retailOutputMicrosPerMillion: retail, upstreamMinimumMicros: upFloor, retailMinimumMicros: retailFloor, calculatorVersion, sourceVersion, verifiedAt, effectiveFrom, effectiveTo, createdAt: t1 };
}
function transitioned() {
  const before = base(), after = clone(before); after.capturedAt = t1; after.hasFloors = true; after.migrations = migrations([...baseline, ...PENDING_MIGRATIONS]);
  applyExpectedSchemaTransition(after.schema);
  after.details.AiApiPriceVersion[0].upstreamMinimumMicros = "0"; after.details.AiApiPriceVersion[0].retailMinimumMicros = "0";
  after.details.StudioModelConfig.push(...[
    ["studio_griphub_gpt_image", "gpt-image", "GPT Image", "17"], ["studio_griphub_gemini_3_1_flash_image", "gemini-3.1-flash-image", "Gemini 3.1 Flash Image", "13"],
  ].map(([id, model, displayName, creditCostPerImage]) => ({ id, provider: "GRIPHUB", model, displayName, isEnabled: false, creditCostPerImage, supportsReferenceImage: false, supportedAspectRatios: ["1:1", "3:2", "2:3"], createdAt: t1, updatedAt: t1 })));
  after.details.AiApiModel.push(...[
    ["ai-model-griphub-minimax-m3", "griphub/minimax-m3", "minimax-m3", "MiniMax M3 via Griphub", "512000"], ["ai-model-griphub-gpt-56-terra", "griphub/gpt-5.6-terra", "gpt-5.6-terra", "GPT-5.6 Terra via Griphub", "128000"], ["ai-model-griphub-gpt-56-sol", "griphub/gpt-5.6-sol", "gpt-5.6-sol", "GPT-5.6 Sol via Griphub", "128000"],
  ].map(([id, publicId, upstreamModelId, displayName, maxOutputTokens]) => ({ id, publicId, provider: "GRIPHUB", upstreamModelId, displayName, enabled: false, maxInputTokens: "32768", maxOutputTokens, privateBetaMaxOutputTokens: "8192", maxRequestBytes: "983040", maxExecutionSeconds: "120", createdAt: t1, updatedAt: t1 })));
  for (const id of ["minimax-m3", "gpt-56-terra", "gpt-56-sol"]) after.details.AiApiProviderHealth.push({ id: `ai-health-griphub-${id}`, modelId: `ai-model-griphub-${id}`, breakerState: "OPEN", healthyUntil: null, consecutiveFailures: "0", lastSuccessAt: null, safeReasonCode: "GRIPHUB_BALANCE_AND_IDEMPOTENCY_UNVERIFIED", updatedAt: t1 });
  const boundary = "2026-10-23T00:00:05.000Z";
  after.details.AiApiPriceVersion.push(
    price("ai-price-griphub-minimax-m3-v1", "ai-model-griphub-minimax-m3", "1", "150000000", "225000000", "text-token-v1", "GRIPHUB-catalog-and-contract-2026-10-21", t1, t0, boundary),
    price("ai-price-griphub-minimax-m3-v2", "ai-model-griphub-minimax-m3", "2", "150000000", "225000000", "text-token-floor-v2", "GRIPHUB-operator-attested-pending-receipt-2026-10-22-Base-routing", null, boundary, null, "3000000", "4500000"),
    price("ai-price-griphub-gpt-56-terra-v1", "ai-model-griphub-gpt-56-terra", "1", "600000000", "900000000", "text-token-v1", "GRIPHUB-catalog-and-contract-2026-10-21", t1, t0, null),
    price("ai-price-griphub-gpt-56-sol-v1", "ai-model-griphub-gpt-56-sol", "1", "1050000000", "1575000000", "text-token-v1", "GRIPHUB-catalog-and-contract-2026-10-21", t1, t0, null),
  );
  finalize(after); return { before, after };
}

describe("AI API v6 exact migration transition", () => {
  it("covers exactly every Prisma model/table with no stale policy entry", () => {
    const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
    const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]).sort();
    expect(PROTECTED_TABLES).toEqual(models);
  });
  it("rejects every schema delta outside the reviewed floor DDL", () => {
    const { before, after } = transitioned();
    const attacks = [
      (s: any) => { s.schema.columns.User.attacker = { position: 99, type: "text", collation: { schema: "pg_catalog", name: "default" }, notNull: false, default: null, identity: "", generated: "" }; },
      (s: any) => { delete s.schema.columns.AiApiPriceVersion.upstreamMinimumMicros; },
      (s: any) => { s.schema.constraints.AiApiPriceVersion[0].definition = "CHECK (true)"; },
      (s: any) => { s.schema.functions["ai_api_price_floor_guard()"].sourceDigest = "f".repeat(64); },
      (s: any) => { s.schema.triggers.User.push({ name: "attacker", enabled: "O", function: "public.attacker", definition: "attacker" }); },
    ];
    for (const attack of attacks) {
      const bad = clone(after); attack(bad);
      expect(() => validateTransition(before, bad, source)).toThrow(/schema|DDL|rejected/);
    }
  });
  it("rejects malformed or duplicate catalog and request-reference witnesses during preflight", () => {
    const { after } = transitioned();
    const attacks = [
      (s: any) => { s.schema.constraints.User.push("malformed"); },
      (s: any) => { s.schema.constraints.AiApiPriceVersion.push(clone(s.schema.constraints.AiApiPriceVersion[0])); },
      (s: any) => { s.schema.objects.push(clone(s.schema.objects[0])); },
      (s: any) => { s.references.push(clone(s.references[0])); },
      (s: any) => { s.references = []; },
    ];
    for (const attack of attacks) {
      const bad = clone(after); attack(bad);
      expect(() => validatePreflight(bad, source)).toThrow(/catalog|reference|schema|duplicate|coverage|rejected/);
    }
  });
  it("rejects every unexpected protected-table addition and rewritten historical migration metadata", () => {
    const { before, after } = transitioned();
    for (const table of PROTECTED_TABLES) {
      if (["StudioModelConfig", "AiApiModel", "AiApiPriceVersion", "AiApiProviderHealth"].includes(table)) continue;
      const bad = clone(after);
      bad.tables[table].push({ key: primaryKey([`${table}-unexpected`]), digest: digest({ attacker: true }) });
      expect(() => validateTransition(before, bad, source)).toThrow(/rejected/);
    }
    for (const field of ["id", "started_at", "finished_at", "applied_steps_count"] as const) {
      const bad = clone(after);
      bad.migrations[0][field] = field === "applied_steps_count" ? 2 : field === "id" ? "rewritten-id" : t1;
      expect(() => validateTransition(before, bad, source)).toThrow(/rejected/);
    }
  });
  it("rejects insert, delete, and mutation for representative previously omitted application tables", () => {
    const { before, after } = transitioned();
    for (const table of ["StudioGeneration", "Product", "DigitalDelivery", "Message", "AuditLog"]) {
      const inserted = clone(after); inserted.tables[table].push({ key: primaryKey([`${table}-insert`]), digest: digest({ insert: true }) });
      expect(() => validateTransition(before, inserted, source)).toThrow(/rejected/);
      const deleted = clone(after); deleted.tables[table] = [];
      expect(() => validateTransition(before, deleted, source)).toThrow(/rejected/);
      const mutated = clone(after); mutated.tables[table][0].digest = digest({ mutate: true });
      expect(() => validateTransition(before, mutated, source)).toThrow(/rejected/);
    }
  });
  it("preserves a real-Prisma-shaped resolved initial baseline without accepting zero-step migrations elsewhere", () => {
    const { before, after } = transitioned();
    const name = "20260928000000_baseline_existing_production";
    for (const snapshot of [before, after]) Object.assign(snapshot.migrations.find((row: any) => row.migration_name === name), { applied_steps_count: 0, logs: "" });
    const again = clone(after); again.capturedAt = t2;
    expect(validatePreflight(before, source)).toBe("first");
    expect(validateTransition(before, after, source)).toBe(true);
    expect(validatePreflight(after, source)).toBe("retry");
    expect(validateSecondNoop(after, again, source)).toBe(true);
    for (const migrationName of Object.keys(source).filter((n) => n !== name)) {
      const bad = clone(after);
      Object.assign(bad.migrations.find((row: any) => row.migration_name === migrationName), { applied_steps_count: 0, logs: "" });
      expect(() => validatePreflight(bad, source)).toThrow(/migration invalid/);
    }
    for (const change of [
      { logs: null }, { logs: "failed" }, { applied_steps_count: -1 }, { applied_steps_count: 0.5 },
      { applied_steps_count: 1 }, { checksum: "f".repeat(64) }, { finished_at: t1 }, { rolled_back_at: t0 },
    ]) {
      const bad = clone(before); Object.assign(bad.migrations.find((row: any) => row.migration_name === name), change);
      expect(() => validatePreflight(bad, source)).toThrow(/migration invalid/);
    }
    const rewritten = clone(after);
    Object.assign(rewritten.migrations.find((row: any) => row.migration_name === name), { applied_steps_count: 1, logs: null });
    expect(() => validateTransition(before, rewritten, source)).toThrow(/historical migration metadata changed/);
  });
  it("rejects pending-migration and new-price timestamps outside S0 to S1", () => {
    const { before, after } = transitioned();
    const attacks = [
      (s: any) => { const row = s.migrations.find((item: any) => item.migration_name === PENDING_MIGRATIONS[0]); row.started_at = row.finished_at = "2026-10-22T00:00:00.000Z"; },
      (s: any) => { s.details.AiApiPriceVersion.find((row: any) => row.id === "ai-price-griphub-minimax-m3-v2").createdAt = "2026-10-24T00:00:00.000Z"; finalize(s); },
      (s: any) => { s.details.AiApiPriceVersion.find((row: any) => row.id === "ai-price-griphub-gpt-56-terra-v1").verifiedAt = "2026-10-22T00:00:00.000Z"; finalize(s); },
      (s: any) => { s.details.AiApiPriceVersion.find((row: any) => row.id === "ai-price-griphub-minimax-m3-v1").effectiveFrom = "2026-10-22T00:00:00.000Z"; finalize(s); },
    ];
    for (const attack of attacks) {
      const bad = clone(after); attack(bad);
      expect(() => validateTransition(before, bad, source)).toThrow(/time|migration|rejected/);
    }
  });
  it("does not reinterpret first-transition timestamps during retry or S1 to S2", () => {
    const { before, after } = transitioned();
    before.capturedAt = "2026-10-23T00:00:00.000Z";
    after.capturedAt = "2026-10-23T00:00:20.000Z";
    for (const table of ["StudioModelConfig", "AiApiModel", "AiApiProviderHealth"])
      for (const row of after.details[table].filter((row: any) => row.id.includes("griphub"))) row.createdAt = row.updatedAt = "2026-10-23T00:00:10.000Z";
    for (const row of after.details.AiApiPriceVersion.filter((row: any) => row.id.includes("griphub"))) row.createdAt = "2026-10-23T00:00:10.000Z";
    finalize(after);
    const s2 = clone(after); s2.capturedAt = "2026-10-23T00:00:40.000Z";
    expect(validateTransition(before, after, source)).toBe(true);
    expect(validateSecondNoop(after, s2, source)).toBe(true);
  });
  it("hashes real migration bytes exactly as Node raw-file SHA-256", () => {
    const file = new URL("../prisma/migrations/20261022120000_ai_api_request_price_floors/migration.sql", import.meta.url);
    expect(migrationSource(root)["20261022120000_ai_api_request_price_floors"]).toBe(createHash("sha256").update(readFileSync(file)).digest("hex"));
  });
  it("rejects oversized CLI stdin before JSON parsing", () => {
    const validator = new URL("../deployment/validate-ai-api-migration-transition.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [validator.pathname, "preflight", root], {
      encoding: "utf8",
      input: "x".repeat(MAX_SNAPSHOT_BYTES + 1),
      maxBuffer: MAX_SNAPSHOT_BYTES + 1024,
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/stdin oversized/);
  });
  it("accepts the reviewed first transition and independently timestamped no-op", () => {
    const { before, after } = transitioned(), s2 = clone(after); s2.capturedAt = t2;
    expect(validatePreflight(before, source)).toBe("first"); expect(validateTransition(before, after, source)).toBe(true); expect(validatePreflight(after, source)).toBe("retry"); expect(validateSecondNoop(after, s2, source)).toBe(true);
  });
  it("rejects a fully-applied retry whose reviewed floor DDL is corrupted", () => {
    const { after } = transitioned();
    for (const mutate of [
      (s: any) => { s.schema.columns.AiApiPriceVersion.upstreamMinimumMicros.default = "1"; },
      (s: any) => { s.schema.constraints.AiApiPriceVersion.find((value: any) => value.name === "AiApiPriceVersion_request_minimum_pair").definition = "CHECK (true)"; },
      (s: any) => { s.schema.triggers.AiApiPriceVersion.find((value: any) => value.name === "Z_AiApiPriceVersion_floor_scope").enabled = "D"; },
      (s: any) => { s.schema.functions["ai_api_price_floor_guard()"].sourceDigest = "f".repeat(64); },
    ]) {
      const bad = clone(after); mutate(bad);
      expect(() => validatePreflight(bad, source)).toThrow(/applied schema|rejected/);
    }
  });
  it("rejects precision loss, one-field price mutations, and all target conflicts", () => {
    const { before, after } = transitioned();
    for (const field of ["currency", "upstreamInputMicrosPerMillion", "upstreamOutputMicrosPerMillion", "retailInputMicrosPerMillion", "retailOutputMicrosPerMillion", "upstreamMinimumMicros", "retailMinimumMicros", "calculatorVersion", "sourceVersion", "verifiedAt", "effectiveFrom", "effectiveTo", "createdAt"] as const) { const bad = clone(after); const row = bad.details.AiApiPriceVersion.find((x: any) => x.id === "ai-price-griphub-minimax-m3-v2"); row[field] = field === "verifiedAt" ? t1 : "wrong"; finalize(bad); expect(() => validateTransition(before, bad, source)).toThrow(/rejected/); }
    const micro = clone(after); micro.details.AiApiPriceVersion[0].upstreamOutputMicrosPerMillion = "9007199254740992"; finalize(micro); expect(() => validateTransition(before, micro, source)).toThrow(/rejected/);
    for (const mutate of [(s: any) => s.details.StudioModelConfig.push({ ...s.details.StudioModelConfig[0], id: "x", provider: "GRIPHUB", model: "gpt-image" }), (s: any) => s.details.AiApiModel.push({ ...s.details.AiApiModel[0], id: "x", publicId: "griphub/minimax-m3" }), (s: any) => s.details.AiApiModel.push({ ...s.details.AiApiModel[0], id: "x", provider: "GRIPHUB", upstreamModelId: "minimax-m3" }), (s: any) => s.details.AiApiPriceVersion.push({ ...s.details.AiApiPriceVersion[0], id: "x", modelId: "ai-model-griphub-minimax-m3", version: "1" }), (s: any) => s.details.AiApiProviderHealth.push({ ...s.details.AiApiProviderHealth[0], id: "x", modelId: "ai-model-griphub-minimax-m3" })]) { const bad = base(); mutate(bad); finalize(bad); expect(() => validatePreflight(bad, source)).toThrow(/conflict/); }
  });
  it("rejects deletion in every touched table and malformed snapshot shapes", () => {
    const { before, after } = transitioned();
    for (const table of ["StudioModelConfig", "AiApiModel", "AiApiPriceVersion", "AiApiProviderHealth"]) { const bad = clone(after); const id = before.details[table][0].id; bad.details[table] = bad.details[table].filter((r: any) => r.id !== id); finalize(bad); expect(() => validateTransition(before, bad, source)).toThrow(/deleted|coverage/); }
    for (const mutate of [(s: any) => { s.extra = true; }, (s: any) => { s.capturedAt = "1"; }, (s: any) => { s.identity = []; }, (s: any) => { s.tables.User = ["bad"]; }, (s: any) => { s.tables.User.push(clone(s.tables.User[0])); }, (s: any) => { delete s.migrations[0].started_at; }]) { const bad = base(); mutate(bad); expect(() => validateSnapshot(bad, source)).toThrow(/rejected/); }
  });
  it("rejects unreviewed executable schema objects even when retry snapshots are identical", () => {
    const { before, after } = transitioned();
    const attacks = [
      (s: any) => { s.schema.functions["rewrite_email_hash()"] = { ...s.schema.functions["ai_api_reject_mutation()"], sourceDigest: "a".repeat(64) }; },
      (s: any) => { s.schema.triggers.PasswordResetRequest.push({ name: "rewrite_email_hash", enabled: "O", function: "public.rewrite_email_hash", definition: "CREATE TRIGGER rewrite_email_hash BEFORE INSERT ON \"PasswordResetRequest\" FOR EACH ROW EXECUTE FUNCTION rewrite_email_hash()" }); },
      (s: any) => { s.schema.triggers.AiApiPriceVersion.find((value: any) => value.name === "AiApiPriceVersion_immutable").enabled = "D"; },
      (s: any) => { s.schema.functions["ai_api_reject_mutation()"].sourceDigest = "b".repeat(64); },
      (s: any) => { s.schema.rules.push({ table: "User", name: "rewrite_user", definition: "CREATE RULE rewrite_user AS ON INSERT TO \"User\" DO INSTEAD NOTHING" }); },
      (s: any) => { s.schema.eventTriggers.push({ name: "ddl_hook", event: "ddl_command_end", enabled: "O", function: "public.ddl_hook" }); },
      (s: any) => { s.schema.objects.push({ name: "AttackerSequence", kind: "S", owner: "owner", acl: null, definition: "{}" }); },
    ];
    for (const attack of attacks) {
      const retry = clone(after); attack(retry);
      const s2 = clone(retry); s2.capturedAt = t2;
      expect(() => validatePreflight(retry, source)).toThrow(/reviewed|rejected/);
      expect(() => validateTransition(retry, s2, source)).toThrow(/reviewed|rejected/);
      expect(() => validateSecondNoop(retry, s2, source)).toThrow(/reviewed|rejected/);
      const first = clone(before); attack(first);
      expect(() => validatePreflight(first, source)).toThrow(/reviewed|rejected/);
    }
  });
  it("rejects owner and EXECUTE ACL drift for every reviewed function, even on an identical retry", () => {
    const { before, after } = transitioned();
    for (const original of [before, after]) for (const name of Object.keys(original.schema.functions)) {
      for (const mutate of [
        (s: any) => { s.schema.functions[name].owner = "untrusted-role"; },
        (s: any) => { s.schema.functions[name].acl = []; },
        (s: any) => { s.schema.functions[name].acl.push({ grantee: "untrusted-role", grantor: "owner", privilege: "EXECUTE", grantable: true }); },
      ]) {
        const bad = clone(original); mutate(bad);
        expect(() => validatePreflight(bad, source)).toThrow(/function|reviewed|rejected/);
        if (bad.hasFloors) {
          const repeated = clone(bad); repeated.capturedAt = t2;
          expect(() => validateTransition(bad, repeated, source)).toThrow(/function|reviewed|rejected/);
          expect(() => validateSecondNoop(bad, repeated, source)).toThrow(/function|reviewed|rejected/);
        }
      }
    }
    for (const name of Object.keys(after.schema.functions)) {
      const bad = clone(after); bad.schema.functions[name].owner = "untrusted-role";
      expect(() => validateTransition(before, bad, source)).toThrow(/function|DDL|rejected/);
    }
    const oldFormat = clone(before); oldFormat.format = "ai-api-transition-v5";
    expect(() => validatePreflight(oldFormat, source)).toThrow(/snapshot format/);
    const noRole = clone(before); delete noRole.identity.databaseRole;
    expect(() => validatePreflight(noRole, source)).toThrow(/identity shape/);
  });
  it("rejects nondefault column collations on first preflight and identical applied retries", () => {
    const { before, after } = transitioned();
    for (const original of [before, after]) for (const table of SCHEMA_TABLES) {
      for (const collation of [{ schema: "pg_catalog", name: "C" }, { schema: "public", name: "case_insensitive" }]) {
        const bad = clone(original); bad.schema.columns[table].id.collation = collation;
        expect(() => validatePreflight(bad, source)).toThrow(/column collation/);
        if (bad.hasFloors) {
          const repeated = clone(bad); repeated.capturedAt = t2;
          expect(() => validateTransition(bad, repeated, source)).toThrow(/column collation/);
          expect(() => validateSecondNoop(bad, repeated, source)).toThrow(/column collation/);
        }
      }
    }
    const bad = clone(after); bad.schema.columns.User.id.collation = { schema: "pg_catalog", name: "C" };
    expect(() => validateTransition(before, bad, source)).toThrow(/User column DDL/);
    const custom = clone(before); custom.schema.environment.collations.push("public.case_insensitive");
    expect(() => validatePreflight(custom, source)).toThrow(/unreviewed.*collation/);
    for (const malformed of [undefined, "pg_catalog.default", { name: "default" }, { schema: "pg_catalog", name: "" }]) {
      const malformedSnapshot = clone(before); malformedSnapshot.schema.columns.User.id.collation = malformed;
      expect(() => validateSnapshot(malformedSnapshot, source)).toThrow(/collation|column shape/);
    }
  });
  it("rejects retry target corruption and non-observational no-op changes", () => {
    const { after } = transitioned();
    for (const mutate of [(s: any) => { s.details.AiApiModel.find((r: any) => r.id.includes("minimax")).enabled = true; }, (s: any) => { s.details.AiApiProviderHealth.find((r: any) => r.id.includes("minimax")).breakerState = "CLOSED"; }, (s: any) => { s.details.AiApiPriceVersion.pop(); }, (s: any) => { s.details.AiApiModel.push({ ...s.details.AiApiModel[0], id: "extra", publicId: "extra" }); }]) { const bad = clone(after); bad.capturedAt = t2; mutate(bad); finalize(bad); expect(() => validateSecondNoop(after, bad, source)).toThrow(/rejected/); }
  });
});
