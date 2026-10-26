import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const deploy = readFileSync(new URL("../deployment/ai-studio-deploy.sh", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const service = readFileSync(new URL("../deployment/digital-store-ai-api-reconciliation.service", import.meta.url), "utf8");
const timer = readFileSync(new URL("../deployment/digital-store-ai-api-reconciliation.timer", import.meta.url), "utf8");
const reconciliationAlert = readFileSync(new URL("../deployment/digital-store-ai-api-reconciliation-alert@.service", import.meta.url), "utf8");
const healthService = readFileSync(new URL("../deployment/digital-store-ai-api-health.service", import.meta.url), "utf8");
const healthTimer = readFileSync(new URL("../deployment/digital-store-ai-api-health.timer", import.meta.url), "utf8");
const healthRoute = readFileSync(new URL("../src/app/api/internal/jobs/ai-api-provider-health/route.ts", import.meta.url), "utf8");
const stage = readFileSync(new URL("../deployment/stage-ai-studio-release.sh", import.meta.url), "utf8");
const rehearsal = readFileSync(new URL("../deployment/rehearse-ai-api-migration.mjs", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const replayMigration = readFileSync(new URL("../prisma/migrations/20261019010000_ai_api_response_replay/migration.sql", import.meta.url), "utf8");
const financialContract = readFileSync(new URL("../deployment/ai-api-financial-contract", import.meta.url), "utf8");
const deploymentRunbook = readFileSync(new URL("../docs/ai-studio-production-deployment.md", import.meta.url), "utf8");
const secretCheckUrl = new URL("../deployment/check-ai-api-secrets.mjs", import.meta.url);
const secretCheck = readFileSync(secretCheckUrl, "utf8");
const envExampleUrl = new URL("../.env.example", import.meta.url);
const priceFloorIntegration = readFileSync(new URL("./ai-api-price-floors.integration.test.ts", import.meta.url), "utf8");
const changedOverlayPaths = [
  ".env.example", "deployment/ai-studio-deploy.sh", "deployment/stage-ai-studio-release.sh", "prisma/schema.prisma",
  "prisma/migrations/20261021220000_add_griphub_studio_disabled/migration.sql", "prisma/migrations/20261021230000_add_griphub_ai_api_disabled/migration.sql", "prisma/migrations/20261022120000_ai_api_request_price_floors/migration.sql", "deployment/validate-ai-api-migration-transition.mjs", "tests/ai-api-migration-transition.test.ts", "tests/ai-api-migration-shared-witness.integration.test.ts",
  "src/app/api/admin/studio/route.ts", "src/app/layout.tsx", "src/lib/ai-api/admin.ts", "src/lib/ai-api/billing.ts", "src/lib/ai-api/catalog.ts", "src/lib/ai-api/ledger-math.ts", "src/lib/ai-api/providers/griphub-chat.ts", "src/lib/ai-api/providers/sekai-chat.ts", "src/lib/ai-api/service.ts", "src/lib/studio/providers/types.ts",
  "tests/admin-studio-griphub-guard.test.ts", "tests/ai-api-billing.test.ts", "tests/ai-api-catalog.test.ts", "tests/ai-api-deployment.test.ts", "tests/ai-api-dispatch-timeout.test.ts", "tests/ai-api-griphub-admission-guard.test.ts", "tests/ai-api-griphub-fail-closed.test.ts", "tests/ai-api-ledger-math.test.ts", "tests/ai-api-price-floor-service.test.ts", "tests/ai-api-price-floors.integration.test.ts", "tests/ai-api-reconciliation-usage.test.ts", "tests/ai-api-request-body.test.ts", "tests/ai-api-service-contract.test.ts", "tests/ai-studio-hardening.test.ts", "tests/griphub-chat-provider.test.ts", "tests/root-layout-dynamic-build.test.ts",
] as const;

function parseOverlayFiles(script: string) {
  const match = script.match(/readonly -a AI_API_OVERLAY_FILES=\(\n([\s\S]*?)\n\)/);
  if (!match) throw new Error("AI_API_OVERLAY_FILES missing");
  return [...match[1].matchAll(/^\s*"([^"]+)"\s*$/gm)].map((entry) => entry[1]);
}

function checkSecrets(values: [string, string, string, string]) {
  return spawnSync(process.execPath, [fileURLToPath(secretCheckUrl)], {
    encoding: "utf8",
    env: {
      ...process.env,
      RIEZZ99_API_KEY_PEPPER: values[0],
      RIEZZ99_REQUEST_FINGERPRINT_SECRET: values[1],
      AUTO_ACCEPT_CRON_SECRET: values[2],
      AI_API_HEALTH_CRON_SECRET: values[3],
    },
  });
}

describe("AI API deployment safety", () => {
  it("includes every new tenant-guard regression and binds this exact new bundle/target", () => {
    const files = parseOverlayFiles(stage);
    for (const path of [
      "tests/ai-api-tenant-guards.test.ts", "tests/ai-api-dispatch-tenant-guards.test.ts",
      "tests/ai-api-tenant-checkpoint.integration.test.ts", "tests/ai-api-responses-service.test.ts",
      "tests/ai-api-price-floor-service.test.ts", "src/lib/ai-api/service.ts",
    ]) expect(files).toContain(path);
    expect(new Set(files).size).toBe(files.length);
    expect(deploymentRunbook).toContain("/root/ai-api-local-guards-approved-20261025-v1");
    expect(deploymentRunbook).toContain("/home/harnet/releases/digital-store-20261025-api-local-guards-r1");
    expect(deploymentRunbook).not.toContain("/root/ai-api-griphub-only-approved-20261025-v1");
    expect(deploymentRunbook).toContain("Stage and rehearsal authorized; production activation NOT authorized");
  });

  it("includes the complete provider-retirement policy and regression closure in canonical staging", () => {
    const files = parseOverlayFiles(stage);
    for (const path of [
      "src/lib/ai-api/provider-policy.ts",
      "tests/ai-api-current-catalog.test.ts", "tests/ai-api-current-model-dto.test.ts",
      "tests/ai-api-retirement-admission.test.ts", "tests/ai-api-retirement-admin.test.ts",
      "tests/ai-api-retirement-health.test.ts", "tests/ai-api-neutral-model-ui.test.ts",
    ]) expect(files).toContain(path);
    expect(deploymentRunbook).toContain("/root/ai-api-local-guards-approved-20261025-v1");
    expect(deploymentRunbook).toContain("/home/harnet/releases/digital-store-20261025-api-local-guards-r1");
  });


  it("gates additive migrations, stable secrets, and state-preserving verification", () => {
    expect(deploy).toContain("20261014060000_ai_api_reseller");
    expect(deploy).toContain("20261015010000_ai_api_customer_console_hardening");
    expect(deploy).toContain("20261019010000_ai_api_response_replay");
    expect(replayMigration.trimStart()).toMatch(/^BEGIN;/);
    expect(replayMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(deploy).toContain("20261014050000_studio_deletion_pending_hardening");
    expect(secretCheck).toContain("RIEZZ99_API_KEY_PEPPER");
    expect(secretCheck).toContain("RIEZZ99_REQUEST_FINGERPRINT_SECRET");
    expect(secretCheck).toContain("AUTO_ACCEPT_CRON_SECRET");
    expect(secretCheck).toContain("AI_API_HEALTH_CRON_SECRET");
    expect(deploy).toContain("validate-ai-api-migration-transition.mjs");
    expect(deploy).toContain("exact reviewed transition validated");
    expect(envExample).toContain('RIEZZ99_API_KEY_PEPPER="');
    expect(envExample).toContain('RIEZZ99_REQUEST_FINGERPRINT_SECRET="');
    expect(envExample).toContain('RIEZZ99_API_KEY_PEPPER=""');
    expect(envExample).toContain('RIEZZ99_REQUEST_FINGERPRINT_SECRET=""');
    expect(envExample).toContain('AI_API_HEALTH_CRON_SECRET=""');
    expect(deploy).toContain("rehearse_ai_api_migration");
    expect(deploy).toContain("check-ai-api-secrets.mjs");
    expect(deploy).toContain("financial_snapshot");
  });

  it("rejects public placeholders and accepts distinct high-entropy secrets", () => {
    expect(checkSecrets([
      "public-placeholder-secret-value-alpha-000000",
      "public-placeholder-secret-value-bravo-111111",
      "public-placeholder-secret-value-charlie-2222",
      "public-placeholder-secret-value-delta-333333",
    ]).status).not.toBe(0);
    const duplicated = "3jh_mwbSnZZwIOWDETFytU1YvC38cl7XdqDivsAM7JA";
    expect(checkSecrets([duplicated, duplicated, "AoZ9OjFk5xxITwhoASOohQ3tsqt0RZEk2dves9kG_eg", "31d574a0d9f34b8410bf08ad2058373e93b02605dc45e1f8699b3c0aad1bf8bd"]).status).not.toBe(0);
    expect(checkSecrets([
      "3jh_mwbSnZZwIOWDETFytU1YvC38cl7XdqDivsAM7JA",
      "AoZ9OjFk5xxITwhoASOohQ3tsqt0RZEk2dves9kG_eg",
      "31d574a0d9f34b8410bf08ad2058373e93b02605dc45e1f8699b3c0aad1bf8bd",
      "de2a0eb5015056df5c5d5cb105e592bfabcb152c60c724c995b235d3cafb7b8c",
    ]).status).toBe(0);
    expect(checkSecrets([
      "31d574a0d9f34b8410bf08ad2058373e93b02605dc45e1f8699b3c0aad1bf8bd",
      "de2a0eb5015056df5c5d5cb105e592bfabcb152c60c724c995b235d3cafb7b8c",
      "95af5a8c623dbf61829aad2d919f6a28e714ace8c8d34c998abb9cd824c7fbca",
      "0d77b1490bfb95d903d579737c1b83f12611ca6e35c4ed5cf19ad4736f71ef0a",
    ]).status).toBe(0);
    expect(checkSecrets([
      "Riezz99ApiKeyPepper_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
      "9876543210abcdefghijklmnopqrstuvwxyzABCDEFG",
    ]).status).not.toBe(0);
  });

  it("uses candidate env values instead of inherited process secrets", () => {
    const strong = [
      "3jh_mwbSnZZwIOWDETFytU1YvC38cl7XdqDivsAM7JA",
      "AoZ9OjFk5xxITwhoASOohQ3tsqt0RZEk2dves9kG_eg",
      "31d574a0d9f34b8410bf08ad2058373e93b02605dc45e1f8699b3c0aad1bf8bd",
      "de2a0eb5015056df5c5d5cb105e592bfabcb152c60c724c995b235d3cafb7b8c",
    ];
    const result = spawnSync("env", [
      "-u", "RIEZZ99_API_KEY_PEPPER",
      "-u", "RIEZZ99_REQUEST_FINGERPRINT_SECRET",
      "-u", "AUTO_ACCEPT_CRON_SECRET",
      "-u", "AI_API_HEALTH_CRON_SECRET",
      process.execPath,
      `--env-file=${fileURLToPath(envExampleUrl)}`,
      fileURLToPath(secretCheckUrl),
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        RIEZZ99_API_KEY_PEPPER: strong[0],
        RIEZZ99_REQUEST_FINGERPRINT_SECRET: strong[1],
        AUTO_ACCEPT_CRON_SECRET: strong[2],
        AI_API_HEALTH_CRON_SECRET: strong[3],
      },
    });
    expect(result.status).not.toBe(0);
    expect(deploy).toContain("env -u RIEZZ99_API_KEY_PEPPER -u RIEZZ99_REQUEST_FINGERPRINT_SECRET -u AUTO_ACCEPT_CRON_SECRET -u AI_API_HEALTH_CRON_SECRET");
  });

  it("installs recurring stale-request reconciliation and guards legacy rollback", () => {
    expect(deploy).toContain("install_ai_api_reconciliation");
    expect(deploy).toContain("install_ai_api_health");
    expect(deploy).toContain("assert_legacy_ai_api_safe");
    expect(deploy).toContain("AI_API_FINANCIAL_CONTRACT=responses-replay-v3");
    expect(financialContract.trim()).toBe("responses-replay-v3");
    expect(deploy).toContain("release_supports_current_ai_api_contract");
    expect(deploy).toContain('if ! release_supports_current_ai_api_contract "$previous_release"; then');
    expect(service).toContain("/api/internal/jobs/ai-api-reconciliation");
    expect(service).toContain("LoadCredential=cron-header:");
    expect(service).toContain("-H @%d/cron-header");
    expect(service).not.toContain("${AUTO_ACCEPT_CRON_SECRET}");
    expect(service).toContain("OnFailure=digital-store-ai-api-reconciliation-alert@%n.service");
    expect(reconciliationAlert).toContain("AI_API_RECONCILIATION_FAILED:%i");
    expect(timer).toContain("OnUnitInactiveSec=60s");
    expect(healthService).toContain("/api/internal/jobs/ai-api-provider-health");
    expect(healthService).toContain("LoadCredential=cron-header:");
    expect(healthService).toContain("-H @%d/cron-header");
    expect(healthService).not.toContain("${AI_API_HEALTH_CRON_SECRET}");
    expect(healthService).toContain("--output /dev/null");
    expect(healthService).toContain("--max-time 40");
    expect(healthService).toContain("health-http=%%{http_code}");
    expect(healthService).toContain("OnFailure=digital-store-ai-api-health-alert@%n.service");
    expect(healthTimer).toContain("OnUnitInactiveSec=60s");
    expect(deploy).not.toContain("rollback_app 1");
    expect(deploy).toContain("RECOVERY_REQUIRED");
    const apply = deploy.slice(deploy.indexOf("  --apply)"), deploy.indexOf("  --rollback-app)"));
    expect(apply.indexOf('activation_phase="traffic_possible"')).toBeLessThan(apply.indexOf('systemctl restart "$SERVICE"'));
    expect(apply.indexOf('smoke_release "$2"')).toBeLessThan(apply.indexOf('activation_phase="traffic_possible"'));
    expect(apply).toContain('assert_post_guard "$LIVE_URL" "/v1/responses"');
    expect(deploy).toContain('ensure_ai_api_legacy_integrity_index "$release"');
    expect(apply.match(/ensure_ai_api_legacy_integrity_index \"\$2\"/g)).toHaveLength(1);
    expect(apply.indexOf('ensure_ai_api_legacy_integrity_index "$2"')).toBeLessThan(apply.indexOf('write_release_dropin "$2"'));
    expect(deploy).toContain('readonly AI_API_LEGACY_INDEX_LOCK_DIR="/run/lock/digital-store"');
    expect(deploy).toContain('install -d -m 0750 -o root -g harnet "$AI_API_LEGACY_INDEX_LOCK_DIR"');
    expect(deploy).not.toContain('install -d -m 0750 -o root -g harnet /run/lock');
    expect(deploy).toContain('flock -n "$AI_API_LEGACY_INDEX_LOCK"');
    expect(deploy).toContain('readonly DEPLOYMENT_LOCK="$AI_API_LEGACY_INDEX_LOCK_DIR/deployment.lock"');
    expect(deploy).toContain('acquire_deployment_lock');
    expect(deploy).toContain('flock -n 8');
    expect(deploy).toContain('acquire_deployment_lock; assert_active');
  });

  it("stages from the active release with an explicit overlay and seals executable artifacts", () => {
    expect(stage).toContain("AI_API_OVERLAY_FILES");
    expect(stage).toContain('"deployment/check-ai-api-secrets.mjs"');
    expect(stage).toContain('"deployment/check-ai-studio-env.mjs"');
    expect(stage).toContain('"prisma/migrations/20261015010000_ai_api_customer_console_hardening/migration.sql"');
    expect(stage).toContain('"prisma/migrations/20261021020000_ai_api_legacy_integrity_index/migration.sql"');
    expect(stage).toContain('"prisma/migrations/20261021220000_add_griphub_studio_disabled/migration.sql"');
    expect(stage).toContain('"prisma/migrations/20261021230000_add_griphub_ai_api_disabled/migration.sql"');
    expect(stage).toContain('"deployment/ensure-ai-api-legacy-integrity-index.mjs"');
    expect(stage).toContain('"package.json"');
    expect(stage).toContain('"package-lock.json"');
    expect(stage).toContain('"src/app/v1/responses/route.ts"');
    expect(stage).toContain('"src/lib/ai-api/responses.ts"');
    expect(stage).toContain('"src/lib/ai-api/tool-schema.ts"');
    expect(stage).toContain('"src/lib/ai-api/response-replay.ts"');
    expect(stage).toContain('"tests/ai-api-responses.test.ts"');
    expect(stage).toContain('"tests/ai-api-responses-route.test.ts"');
    expect(stage).toContain('"tests/ai-api-responses-service.test.ts"');
    expect(stage).toContain('"tests/ai-api-dispatch-timeout.test.ts"');
    expect(stage).toContain('"tests/ai-api-response-replay.test.ts"');
    expect(stage).toContain('"tests/ai-api-reconciliation-usage.test.ts"');
    expect(stage).toContain('"src/app/dashboard/api/page.tsx"');
    expect(stage).toContain('"src/app/admin/ai-api/page.tsx"');
    expect(stage).toContain('"src/lib/security/same-origin.ts"');
    expect(stage).toContain('"src/lib/admin-mfa-service.ts"');
    expect(stage).toContain('"src/lib/ai-api/provider-health.ts"');
    expect(stage).toContain('"src/lib/ai-api/providers/sekai-health.ts"');
    expect(stage).toContain('"src/lib/ai-api/providers/griphub-chat.ts"');
    expect(stage).toContain('"src/app/api/internal/jobs/ai-api-provider-health/route.ts"');
    expect(stage).toContain('"deployment/digital-store-ai-api-health.service"');
    expect(stage).toContain('"deployment/digital-store-ai-api-health.timer"');
    expect(stage).toContain('"deployment/digital-store-ai-api-health-alert@.service"');
    expect(stage).toContain('"deployment/digital-store-ai-api-reconciliation-alert@.service"');
    expect(stage).toContain('"deployment/check-next-login-guard.mjs"');
    expect(stage).toContain('"deployment/ai-api-financial-contract"');
    expect(stage).toContain('"tests/ai-api-health-monitor.test.ts"');
    expect(stage).toContain('"tests/ai-api-griphub-fail-closed.test.ts"');
    expect(stage).toContain('"tests/ai-api-griphub-admission-guard.test.ts"');
    expect(stage).toContain('"tests/ai-api-admin-overview-route.test.ts"');
    expect(stage).toContain('"tests/admin-studio-griphub-guard.test.ts"');
    expect(stage).toContain('"tests/ai-api-admin-read-auth.test.ts"');
    expect(stage).toContain('"src/auth.ts"');
    expect(stage).toContain('"src/lib/prisma.ts"');
    expect(stage).toContain('"src/lib/admin-mfa.ts"');
    expect(stage).toContain('"src/lib/auth-guards.ts"');
    expect(stage).toContain('"src/lib/security/secrets.ts"');
    expect(stage).toContain('"src/lib/active-admin.ts"');
    expect(stage).toContain('"tests/ai-api-legacy-index-helper.integration.test.ts"');
    expect(stage).toContain("ACTIVE_RELEASE");
    expect(stage).not.toContain("TARGET_RELEASE=\"${1:-/home/harnet/releases/digital-store-20261021-ai-api-legacy-integrity-r2}\"");
    expect(stage).not.toContain('TARGET_RELEASE="${1:-/home/harnet/releases/digital-store-20261021-ai-api-responses-final-r2}"');
    expect(stage).not.toContain("rsync -a --exclude '.env*'");
    expect(stage).toContain('rsync -a --sparse --delete --exclude \'.env*\'');
    expect(stage).toContain("BUILD_INPUT_PATHS");
    expect(stage).toContain("seal_dir");
    expect(stage).toContain('seal_dir="$(mktemp -d "$(dirname "$TARGET_RELEASE")/.ai-api-seal.XXXXXX")"');
    expect(stage).toContain('stage_dir="$(mktemp -d "$BUILD_ROOT/.ai-api-stage.XXXXXX")"');
    expect(stage).toContain('for relative in "${BUILD_INPUT_PATHS[@]}"');
    expect(stage).not.toContain('chown -R "$BUILD_USER:$BUILD_GROUP" "$stage_dir"');
    expect(stage).toContain('chown -hR root:"$BUILD_GROUP" "$stage_dir"');
    expect(stage).toContain('install -d -o "$BUILD_USER" -g "$BUILD_GROUP" -m 0750 "$stage_dir/node_modules" "$stage_dir/.next"');
    expect(stage).toContain("run_builder_unit");
    expect(stage).toContain('run_builder_unit yes AUTH_SECRET="$BUILD_AUTH_SECRET"');
    expect(stage).toContain('/usr/bin/env -i');
    expect(stage).toContain('run_builder_unit no /bin/sh -c \'npm ci');
    expect(stage).toContain('readonly PRISMA_ENGINE_COMMIT="c2990dca591cba766e3b7ef5d9e8a84796e47ab7"');
    expect(stage).toContain('readonly PRISMA_SCHEMA_ENGINE_GZ_SHA256="6c1dfdfe34538487b088fd21b3152147e1bd3c9d0c00b4fc6ecae40ceba83d8a"');
    expect(stage).toContain('readonly PRISMA_LIBQUERY_ENGINE_GZ_SHA256="d380872cc8a17310c6ebb249dc000f4fcbfbbd51ddc36beb57b1ed0c54c6d610"');
    expect(stage).toContain('env -i PATH=/usr/bin:/bin curl --noproxy');
    expect(stage).toContain('download_prisma_engine "schema-engine"');
    expect(stage).toContain('download_prisma_engine "libquery_engine.so.node"');
    const dependencyPhase = stage.slice(stage.indexOf("run_builder_unit no /bin/sh -c 'npm ci"));
    expect(dependencyPhase.indexOf('validate_build_tree "$stage_dir"')).toBeLessThan(dependencyPhase.indexOf('download_prisma_engine "schema-engine"'));
    expect(stage).not.toContain("require('$stage_dir/node_modules/@prisma/engines-version/package.json')");
    expect(stage).toContain("JSON.parse(readFileSync(process.argv[1], \"utf8\"))");
    expect(stage).toContain('Prisma engine metadata bukan regular file single-link');
    expect(stage).toContain('PRISMA_SCHEMA_ENGINE_BINARY="$stage_dir/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x"');
    expect(stage).toContain('PRISMA_QUERY_ENGINE_LIBRARY="$stage_dir/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node"');
    expect(stage).toContain('./node_modules/.bin/prisma generate --schema ./prisma/schema.prisma');
    expect(stage).toContain("ProtectSystem=strict");
    expect(stage).toContain("ProtectHome=yes");
    expect(stage).toContain("ReadWritePaths=$stage_dir");
    expect(stage).toContain("ReadOnlyPaths=-$stage_dir/node_modules/@prisma/engines");
    expect(stage).toContain("-/run/postgresql -/var/run/postgresql -/run/mysqld -/var/run/mysqld");
    expect(stage).toContain("RestrictAddressFamilies=AF_INET AF_INET6");
    expect(stage).toContain("SystemCallArchitectures=native");
    expect(stage).not.toContain("SystemCallFilter=~@network-io");
    expect(stage).toContain("SystemCallFilter=~io_uring_setup io_uring_enter io_uring_register");
    expect(stage).toContain("SystemCallErrorNumber=EPERM");
    expect(stage).toContain("TemporaryFileSystem=/run:ro");
    expect(stage).toContain("InaccessiblePaths=-/tmp -/var/tmp");
    expect(stage).toContain("PrivateTmp=no");
    expect(stage).toContain('TMPDIR="$stage_dir/.tmp"');
    expect(stage).toContain("MemoryMax=60%");
    expect(stage).toContain("TasksMax=512");
    expect(stage).toContain('stage_image="$(mktemp "$BUILD_ROOT/.ai-api-stage.XXXXXX.img")"');
    expect(stage).toContain('truncate -s 3G "$stage_image"');
    expect(stage).toContain('mkfs.ext4 -q -m 0 "$stage_image"');
    expect(stage).toContain('mount -o loop,nodev,nosuid,noatime "$stage_image" "$stage_dir"');
    expect(stage).toContain('umount "$stage_dir"');
    expect(stage).toContain('readonly MAX_BUILD_FILE_BYTES=$((512 * 1024 * 1024))');
    expect(stage).toContain('readonly MAX_BUILD_LOGICAL_BYTES=$((2 * 1024 * 1024 * 1024))');
    expect(stage).toContain("logical size build melebihi batas");
    expect(stage).toContain('rsync -a --sparse --delete --chown=root:harnet "$stage_dir/node_modules/"');
    expect(stage).toContain('head -c 129 -- "$seal_dir/.next/BUILD_ID"');
    expect(stage).toContain("--max-filesize 9000000");
    expect(stage).toContain("--connect-timeout 10");
    expect(stage).toContain("--max-time 120");
    expect(stage).toContain('npm_config_userconfig="$NPM_USER_CONFIG"');
    expect(stage).toContain('npm_config_globalconfig="$NPM_GLOBAL_CONFIG"');
    expect(stage).not.toContain("npm_config_userconfig=/dev/null");
    expect(stage).not.toContain("npm_config_globalconfig=/dev/null");
    expect(stage).toContain('runuser -u "$BUILD_USER" -- test ! -r "$env_snapshot"');
    expect(stage).toContain("BUILD_AUTH_SECRET");
    expect(stage).toContain("build-only AUTH_SECRET masuk ke artefak");
    expect(stage).toContain("validate_build_tree");
    expect(stage).toContain("symlink build tidak aman");
    expect(stage).toContain("tipe file build tidak aman");
    expect(stage).toContain('pgrep -u "$BUILD_USER"');
    expect(stage).toContain('rsync -a --sparse --delete --chown=root:harnet "$stage_dir/node_modules/" "$seal_dir/node_modules/"');
    expect(stage).toContain('rsync -a --sparse --delete --chown=root:harnet "$stage_dir/.next/" "$seal_dir/.next/"');
    expect(stage).toContain('rm -rf -- "$seal_dir/.next/cache"');
    expect(stage).toContain('install -d -o harnet -g harnet -m 0700 "$seal_dir/.next/cache"');
    expect(stage).toContain("candidate_source_manifest");
    expect(stage).toContain("candidate_source_manifest_after");
    expect(stage).toContain('cmp -s "$candidate_source_manifest" "$candidate_source_manifest_after"');
    expect(stage).toContain("source candidate berubah selama dependency install/build");
    expect(stage).toContain("build membuat environment file");
    expect(stage).toContain('! -name ".env.example"');
    expect(stage).toContain('rm -f -- "$stage_dir/tsconfig.tsbuildinfo"');
    expect(stage).toContain('install -o root -g harnet -m 0640 "$env_snapshot" "$seal_dir/.env"');
    expect(stage).toContain('cmp -s "$env_snapshot" "$seal_dir/.env"');
    expect(stage).toContain("overlay berubah setelah sealing");
    expect(stage).not.toContain('mv -- "$seal_dir" "$TARGET_RELEASE"');
    expect(stage).toContain('mv -T -n -- "$seal_dir" "$TARGET_RELEASE"');
    expect(stage).toContain('[ ! -e "$seal_dir" ] || die "publikasi candidate gagal atau target muncul bersamaan"');
    expect(stage).toContain('flock -n 9');
    expect(stage).toContain('[[ "$SCRIPT_PATH" == /root/* ]]');
    expect(stage).toContain('[ "$(stat -c \'%U:%G %a\' "$SOURCE_ROOT")" = "root:root 700" ]');
    expect(stage).toContain('systemctl is-active --quiet digital-store.service');
    expect(stage).toContain('readlink -f -- "/proc/$ACTIVE_MAIN_PID/cwd"');
    expect(stage).toContain('cmp -s "$baseline_manifest" "$baseline_copy_manifest"');
    expect(stage).toContain('validate_baseline_tree "$ACTIVE_RELEASE"');
    expect(stage).toContain("logical size baseline melebihi batas");
    expect(stage).toContain('validate_build_tree "$seal_dir"');
    const sealPhase = stage.slice(stage.indexOf('seal_dir="$(mktemp'));
    expect(stage.indexOf('validate_baseline_tree "$ACTIVE_RELEASE"')).toBeLessThan(stage.indexOf('rsync -a --sparse --delete --exclude'));
    expect(sealPhase.indexOf('validate_build_tree "$seal_dir"')).toBeLessThan(sealPhase.indexOf('for relative in "${AI_API_OVERLAY_FILES[@]}"'));
    expect(stage).toContain('chown -hR root:harnet "$seal_dir"');
    expect(stage).toContain('runuser -u harnet -- /usr/bin/env -C / find "$seal_dir"');
    expect(stage).toContain('writable_path="$(runuser -u harnet');
    expect(stage).toContain('-path "$seal_dir/.next/cache" -prune -o -writable -print -quit');
    const postBuildPhase = stage.slice(stage.indexOf('! pgrep -u "$BUILD_USER" >/dev/null || die "proses builder tersisa setelah test/build"'));
    expect(postBuildPhase.indexOf('validate_build_tree "$stage_dir"')).toBeLessThan(postBuildPhase.indexOf('[ -s "$stage_dir/.next/BUILD_ID" ]'));
    expect(stage.indexOf("trap cleanup EXIT")).toBeLessThan(stage.indexOf('env_snapshot="$(mktemp'));
    expect(stage).toContain('root:harnet 750" ] || die "parent release');
  });

  it("keeps the executable staging closure complete, unique, and source-backed", () => {
    const stagingFiles = parseOverlayFiles(stage);
    expect(stagingFiles).toHaveLength(133);
    expect(new Set(stagingFiles).size).toBe(stagingFiles.length);
    for (const path of [
      "src/app/api/admin/studio/route.ts", "src/app/layout.tsx", "src/lib/studio/providers/types.ts",
      "tests/ai-studio-hardening.test.ts", "tests/root-layout-dynamic-build.test.ts",
    ]) expect(stagingFiles).toContain(path);
    for (const path of changedOverlayPaths) expect(stagingFiles).toContain(path);
    for (const path of stagingFiles) {
      const file = fileURLToPath(new URL(`../${path}`, import.meta.url));
      expect(statSync(file).isFile()).toBe(true);
    }
    for (const path of [
      "deployment/backup-production-db.mjs", "src/app/uploads/products/[filename]/route.ts", "src/app/uploads/stores/[filename]/route.ts",
    ]) expect(statSync(fileURLToPath(new URL(`../${path}`, import.meta.url))).isFile()).toBe(true);
  });

  it("requires one new release target and documents the same future target throughout", () => {
    const future = "/home/harnet/releases/digital-store-20261025-api-local-guards-r1";
    const rootBundle = "/root/ai-api-local-guards-approved-20261025-v1";
    expect(stage).toContain('if [ "$#" -ne 1 ]; then');
    expect(stage).toContain('exit 2');
    expect(stage).toContain('readonly TARGET_RELEASE="$(readlink -m -- "$1")"');
    expect(stage).not.toContain('TARGET_RELEASE="${1:-');
    expect(stage).toContain('readonly ACTIVE_RELEASE="$(systemctl show digital-store.service -p WorkingDirectory --value)"');
    expect(stage).toContain('[ "$TARGET_RELEASE" != "$ACTIVE_RELEASE" ]');
    expect(stage).toContain('[ ! -e "$TARGET_RELEASE" ]');
    expect(deploymentRunbook).toContain(rootBundle);
    expect(deploymentRunbook).toContain(`${future}/deployment/ai-studio-deploy.sh --check-only ${future}`);
    expect(deploymentRunbook).toContain(`${future}/deployment/ai-studio-deploy.sh --apply ${future}`);
    expect(deploymentRunbook).not.toContain("ai-api-legacy-integrity-approved-20261021-r9");
    expect(deploymentRunbook).not.toContain("ai-api-floor-approved-20261024-v12");
    expect(deploymentRunbook).not.toContain("digital-store-20261023-ai-api-floor-r2");
    expect(deploymentRunbook).not.toContain("ai-api-floor-approved-20261024-v13");
    expect(deploymentRunbook).not.toContain("digital-store-20261024-ai-api-floor-r3");
    expect(deploymentRunbook).not.toContain("ai-api-floor-approved-20261024-v14");
    expect(deploymentRunbook).not.toContain("digital-store-20261024-ai-api-floor-r4");
    expect(deploymentRunbook).toContain("root:root 0755");
    expect(deploymentRunbook).toContain("os.tmpdir()");
    expect(deploymentRunbook).toContain(`${rootBundle}/source/deployment/stage-ai-studio-release.sh ${future}`);
    expect(deploymentRunbook).toContain("ai-api-transition-v6");
  });

  it("keeps the disposable price-floor fixture inside the builder-provided temporary root", () => {
    expect(priceFloorIntegration).toContain('import { tmpdir, userInfo } from "node:os"');
    expect(priceFloorIntegration).toContain('mkdtempSync(join(tmpdir(), "ai-api-price-floors-"))');
    expect(priceFloorIntegration).not.toContain('join("/tmp", "ai-api-price-floors-")');
    expect(stage).toContain("InaccessiblePaths=-/tmp -/var/tmp");
    expect(stage).toContain('TMPDIR="$stage_dir/.tmp"');
    expect(stage).toContain('TMP="$stage_dir/.tmp"');
    expect(stage).toContain('TEMP="$stage_dir/.tmp"');
  });

  it("keeps the AI API price-floor migration in the reviewed candidate closure and rehearses it before activation", () => {
    const floorMigration = "20261022120000_ai_api_request_price_floors";
    const floorMigrationPath = `prisma/migrations/${floorMigration}/migration.sql`;
    const floorServiceTest = "tests/ai-api-price-floor-service.test.ts";
    const floorIntegrationTest = "tests/ai-api-price-floors.integration.test.ts";

    expect(stage).toContain(`"${floorMigrationPath}"`);
    expect(stage).toContain(`"${floorServiceTest}"`);
    expect(stage).toContain(`"${floorIntegrationTest}"`);
    expect(stage.indexOf(`"${floorMigrationPath}"`)).toBeGreaterThan(stage.indexOf('"prisma/migrations/20261021230000_add_griphub_ai_api_disabled/migration.sql"'));
    expect(stage).toContain('"deployment/stage-ai-studio-release.sh"');
    expect(stage).toContain('"${#manifest_paths[@]}" -eq "${#AI_API_OVERLAY_FILES[@]}"');
    expect(stage).toContain('urutan/path manifest review tidak sesuai overlay');
    expect(stage).toContain('(cd "$SOURCE_ROOT" && sha256sum --check --status "$APPROVED_MANIFEST")');
    expect(stage).toContain('(cd "$seal_dir" && sha256sum --check --status "$review_manifest")');

    expect(deploy).toContain(floorMigration);
    expect(deploy).toContain('migrate deploy --schema "$release/prisma/schema.prisma"');
    expect(rehearsal).toContain('run("node", [prismaCli, "migrate", "deploy", "--schema", join(candidate, "prisma/schema.prisma")]');
    expect(rehearsal).toContain('cwd: candidate');
    // Behavior of runTransitionWitness/bindCloneIdentity is exercised on real PostgreSQL
    // in ai-api-migration-shared-witness.integration.test.ts; this guards the wiring.
    expect(rehearsal).toContain("bindCloneIdentity(tempUrl.toString(), cloneIdentity, { database: tempDb, cluster: sourceClusterIdentity, systemIdentifier: sourceSystemIdentifier })");
    expect(rehearsal).toContain("runTransitionWitness(candidate, binding,");
    expect(rehearsal).not.toMatch(/process\.env(?:\.|\[)[A-Z_"]*\s*=/);
    expect(rehearsal).not.toContain("AI_API_TRANSITION_EXPECTED");
    expect(rehearsal).not.toContain('griphub');
    expect(rehearsal).not.toMatch(/aiApi(?:Model|ProviderHealth)\.(?:update|updateMany|create|delete)/);
  });

  it("documents only the sealed current candidate and current environment ownership", () => {
    expect(deploymentRunbook).toContain("npm run lint");
    expect(deploymentRunbook).not.toContain("deployment/write-release-build-manifest.sh write");
    expect(deploymentRunbook).toContain("/root/ai-api-local-guards-approved-20261025-v1/STAGING-APPROVED-MANIFEST.sha256");
    expect(deploymentRunbook).toContain("/home/harnet/releases/digital-store-20261025-api-local-guards-r1/deployment/ai-studio-deploy.sh --apply /home/harnet/releases/digital-store-20261025-api-local-guards-r1");
    expect(deploymentRunbook).toContain("Stage and rehearsal authorized; production activation NOT authorized");
    expect(deploy).toContain("may call non-billable provider health endpoints");
    expect(deploy).not.toContain("It never\n# calls a provider endpoint");
    expect(deploymentRunbook).not.toContain("digital-store-20261004-ai-studio");
    expect(deploymentRunbook).toContain("root:harnet");
    expect(deploymentRunbook).toContain("0640");
    expect(deploymentRunbook).not.toContain("harnet:harnet");
    expect(deploymentRunbook).toContain("clone sementara pada cluster PostgreSQL lokal yang sama");
    expect(deploymentRunbook).toContain("CREATE INDEX CONCURRENTLY");
    expect(deploymentRunbook).toContain("lock_timeout");
    expect(deploymentRunbook).toContain("/run/lock/digital-store");
    expect(deploymentRunbook).toContain("deployment lock");
    expect(deploymentRunbook).toContain("tidak melakukan rollback otomatis setelah traffic aktif");
  });

  it("contains the clone rehearsal in a dedicated process group and a reduced environment", () => {
    expect(rehearsal).toContain("detached: true");
    expect(rehearsal).toContain("process.kill(-child.pid");
    expect(rehearsal).toContain("process.kill(-pid, 0)");
    expect(rehearsal).toContain("terminateProcessGroup(child)");
    expect(rehearsal).not.toContain("...process.env, ...Object.fromEntries(values)");
    expect(rehearsal).toContain("const appEnv = {");
    expect(rehearsal).toContain("AUTH_SECRET: rehearsalSecret");
    expect(rehearsal).toContain("NODE_ENV: \"production\"");
    expect(rehearsal).toContain("AI_API_LEGACY_INDEX_DATABASE_URL");
    expect(rehearsal).toContain("AI_API_LEGACY_INDEX_EXPECTED_DATABASE");
    expect(rehearsal).toContain("AI_API_LEGACY_INDEX_EXPECTED_CLUSTER_IDENTITY");
    expect(rehearsal).toContain("ensureLegacyIntegrityIndex(candidate, tempUrl, harnet, sourceClusterIdentity)");
  });

  it("runs deployment environment parity with the sealed candidate helper", () => {
    expect(deploy).toContain('node "$release/deployment/check-ai-studio-env.mjs" "$release/.env" "$previous_release/.env"');
    expect(deploy).not.toContain('node "$(dirname "$0")/check-ai-studio-env.mjs"');
  });

  it("uses only sealed deployment helpers and converges protected health credentials", () => {
    expect(deploy).toContain('SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    expect(deploy).toContain('[ "$SCRIPT_DIR" = "$release/deployment" ]');
    expect(deploy).toContain('"$release/deployment/check-next-login-guard.mjs"');
    expect(deploy).not.toContain('"$(dirname "$0")/check-next-login-guard.mjs"');
    expect(deploy).toContain('chmod 0600 "$AI_API_HEALTH_CREDENTIAL"');
    expect(deploy).toContain("stat -c '%U:%G %a' \"$AI_API_HEALTH_CREDENTIAL\"");
    expect(deploy).toContain("assert_release_env");
    expect(deploy).toContain('root:harnet 640" ] || die "env candidate');
    expect(deploy).toContain("sha256sum --check --status .release-env.sha256");
  });

  it("backs up, restores, and verifies the complete health-monitor installation", () => {
    expect(deploy).toContain("backup_ai_api_health_installation");
    expect(deploy).toContain("restore_ai_api_health_installation");
    expect(deploy).toContain("verify_ai_api_health_installation");
    expect(deploy).toContain("digital-store-ai-api-health.service.backup");
    expect(deploy).toContain("digital-store-ai-api-health.timer.backup");
    expect(deploy).toContain("digital-store-ai-api-health-alert.service.backup");
    expect(deploy).toContain("ai-api-health.header.backup");
    expect(deploy).toContain("systemctl is-enabled digital-store-ai-api-health.timer");
    expect(deploy).toContain("NextElapseUSecMonotonic");
    expect(deploy).toContain('cmp -s "$release/deployment/digital-store-ai-api-health.service" "$AI_API_HEALTH_SERVICE"');
    expect(deploy).toContain('install -d -o root -g harnet -m 0710 "$backup_dir"');
    expect(deploy).toContain("sha256sum --check --status sha256");
    expect(deploy).toContain("enabled-runtime");
    expect(deploy).toContain("masked-runtime");
    expect(deploy).toContain("AUTO_HEALTH_MONITOR_INSTALL_FAILED"); // degraded deployment only
    expect(deploy).toContain("validate_backup_dir");
    expect(deploy).toContain('make_backup "$2"');
    expect(deploy).toContain("active-release-build-id");
    expect(deploy).toContain("DEPLOY_DEGRADED");
    expect(deploy).toContain("LastTriggerUSecMonotonic");
    const verification = deploy.slice(deploy.indexOf("verify_ai_api_health_installation()"), deploy.indexOf("make_backup()"));
    expect(verification).toContain("systemctl start digital-store-ai-api-health.service");
    expect(verification).toContain("ExecMainStatus");
    expect(verification).toContain("wait_invocation_marker");
    expect(verification).toContain("health-http=503");
    expect(verification).not.toContain('-H "@$AI_API_HEALTH_CREDENTIAL"');
    expect(verification).toContain('health_verification_started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"');
    expect(verification).toContain("model.providerHealth.breakerState !== 'CLOSED'");
    expect(verification).toContain("lastSuccessAt < startedAt");
    expect(verification).toContain("healthyUntil <= now");
  });

  it("restores both scheduler installations and fails closed after a partial manual rollback restore", () => {
    // Behavior is proved by work-v10-evidence/recovery-failure-injection-test.sh
    // (root, exact function bytes, injected systemd/app/fail-close faults).
    const rollback = deploy.slice(deploy.indexOf("rollback_app()"), deploy.indexOf("restore_ai_api_health_files_held_stopped()"));
    expect(rollback).toContain("local reconciliation_restore_status=0 health_restore_status=0 app_status=0 fail_close_status=0");
    expect(rollback).toContain("restore_ai_api_reconciliation_installation || reconciliation_restore_status=$?");
    expect(rollback).toContain("restore_ai_api_health_installation || health_restore_status=$?");
    expect(rollback).toContain("restore_ai_api_health_files_held_stopped || true");
    expect(rollback).not.toMatch(/systemctl restart "\$SERVICE" \|\| return 1|poll_health "\$LIVE_URL" \|\| return 1/);
    expect(rollback.indexOf("restore_ai_api_health_installation || health_restore_status=$?")).toBeLessThan(rollback.indexOf('if [ "$app_status" -ne 0 ] || [ "$reconciliation_restore_status" -ne 0 ] || [ "$health_restore_status" -ne 0 ]; then'));
    expect(rollback).toContain('fail_close_ai_api_health "$previous_release" || fail_close_status=1');
    expect(rollback).toContain("ROLLBACK_SCHEDULER_RESTORE_FAILED_CLOSED");
    const recovery = deploy.slice(deploy.indexOf("migration_quiescence_recovery()"), deploy.indexOf("on_exit()"));
    expect(recovery).toContain("restore_ai_api_reconciliation_installation || reconciliation_status=$?");
    expect(recovery).not.toContain("restore_ai_api_health_installation");
    expect(recovery).toContain('if [ "$app_status" -ne 0 ] || [ "$reconciliation_status" -ne 0 ] || [ "$health_status" -ne 0 ] || [ "$fail_close_status" -ne 0 ]; then');
    const onExit = deploy.slice(deploy.indexOf("on_exit()"), deploy.indexOf("trap on_exit EXIT"));
    expect(onExit).not.toContain('rm -rf -- "$snapshot_evidence_dir"');
  });

  it("quiesces every production DB writer with systemd-255 semantics and recovers on signals", () => {
    // Behavior: work-v10-evidence/recovery-failure-injection-test.sh (Q0/Q1/S-*/D1).
    for (const unit of ["digital-store-sociabuzz.timer", "digital-store-sociabuzz-wakeup.path", "digital-store-push-queue.timer", "digital-store-auto-accept.timer"]) expect(deploy).toContain(`"${unit}"`);
    const quiesce = deploy.slice(deploy.indexOf("quiesce_migration_writers()"), deploy.indexOf("run_migration()"));
    expect(quiesce.indexOf("stop_aux_writers")).toBeLessThan(quiesce.indexOf('systemctl stop "$SERVICE"'));
    expect(quiesce).not.toContain("-p MainPID");
    const stopped = deploy.slice(deploy.indexOf("assert_unit_stopped()"), deploy.indexOf("restore_ai_api_reconciliation_installation()"));
    expect(stopped).toContain("*.timer|*.path) return 0 ;;");
    expect(stopped).toContain('systemctl reset-failed "$unit"');
    expect(deploy).toContain("aux-writers.state > sha256");
    const recovery = deploy.slice(deploy.indexOf("migration_quiescence_recovery()"), deploy.indexOf("on_exit()"));
    expect(recovery).toContain("restore_aux_writers || reconciliation_status=1");
    expect(deploy).toContain('readonly RECOVERY_FAIL_CLOSE_REASON="DEPLOY_RECOVERY_FAIL_CLOSED"');
    expect(deploy).toContain('fail_close_ai_api_health "$2" AUTO_HEALTH_MONITOR_INSTALL_FAILED');
    expect(deploy).not.toContain("safeReasonCode: 'AUTO_HEALTH_MONITOR_INSTALL_FAILED'");
    const traps = deploy.slice(deploy.indexOf("trap on_exit EXIT"), deploy.indexOf('case "${1:-}" in'));
    for (const trap of ["trap 'exit 129' HUP", "trap 'exit 130' INT", "trap 'exit 143' TERM"]) expect(traps).toContain(trap);
    for (const kind of ["reconciliation", "health"]) {
      const restore = deploy.slice(deploy.indexOf(`restore_ai_api_${kind}_installation() {`), deploy.indexOf(kind === "reconciliation" ? "verify_ai_api_reconciliation_installation()" : "verify_ai_api_health_installation()"));
      expect(restore).not.toMatch(/install -o root[^\n]*\|\| return 1/);
      expect(restore).toContain("restore_files_status=1");
    }
  });

  it("serializes manual worker verification before enabling recurring timers", () => {
    const reconcileInstall = deploy.slice(deploy.indexOf("install_ai_api_reconciliation()"), deploy.indexOf("install_ai_api_health()"));
    const reconcileVerify = deploy.slice(deploy.indexOf("verify_ai_api_reconciliation_installation()"), deploy.indexOf("backup_ai_api_health_installation()"));
    expect(reconcileInstall).toContain("systemctl enable digital-store-ai-api-reconciliation.timer");
    expect(reconcileInstall).not.toContain("enable --now digital-store-ai-api-reconciliation.timer");
    expect(reconcileVerify.indexOf("systemctl start digital-store-ai-api-reconciliation.service")).toBeLessThan(reconcileVerify.indexOf("systemctl start digital-store-ai-api-reconciliation.timer"));
    expect(reconcileVerify).toContain('initial_invocation="$invocation"');
    expect(reconcileVerify).toContain('"$invocation" != "$initial_invocation"');

    const healthInstall = deploy.slice(deploy.indexOf("install_ai_api_health()"), deploy.indexOf("assert_legacy_ai_api_safe()"));
    const healthVerify = deploy.slice(deploy.indexOf("verify_ai_api_health_installation()"), deploy.indexOf("make_backup()"));
    expect(healthInstall).toContain("systemctl enable digital-store-ai-api-health.timer");
    expect(healthInstall).not.toContain("enable --now digital-store-ai-api-health.timer");
    expect(healthVerify.indexOf("systemctl start digital-store-ai-api-health.service")).toBeLessThan(healthVerify.indexOf("systemctl start digital-store-ai-api-health.timer"));
    expect(healthVerify).toContain('initial_invocation="$invocation"');
    expect(healthVerify).toContain('"$invocation" != "$initial_invocation"');
  });

  it("does not disclose cron-secret configuration state to unauthenticated callers", () => {
    expect(healthRoute).not.toContain("Job secret is not configured.");
    expect(healthRoute).toContain("if (!expected || !hasValidSecret(request, expected))");
  });

  it("keeps clone operations on the verified source cluster and smokes the migrated clone", () => {
    expect(rehearsal).toContain("sourceClusterIdentity");
    expect(rehearsal).toContain("clusterDataDirectory");
    expect(rehearsal).not.toContain("const sourceDataDirectory = run");
    expect(rehearsal).toContain("pg_postmaster_start_time");
    expect(rehearsal).toContain('"--force"');
    expect(rehearsal).toContain("smokeMigratedClone");
    expect(rehearsal).toContain("verifySharedProviderAdmissionLock");
    expect(rehearsal).toContain("pg_advisory_xact_lock");
    expect(rehearsal).toContain("prisma migrate diff");
    expect(rehearsal).toContain("financialSnapshot");
    expect(rehearsal).toContain('"SellerEarning"');
    expect(rehearsal).toContain('"CancellationRequest"');
    expect(rehearsal).toContain("main().then(() => process.exit(0)");
  });

  it("preserves the existing AI API operational state during rehearsal and migration", () => {
    expect(rehearsal).toContain("runTransitionWitness(candidate, binding,");
    expect(rehearsal).not.toContain("m.some(x=>x.enabled)");
    expect(rehearsal).not.toContain("r!==0||l!==0");
    expect(deploy).toContain("transition_capture()");
    expect(deploy).toContain("validate_transition_files");
    expect(deploy).toContain("migration_quiesced");
    const transitionCapture = deploy.slice(deploy.indexOf("transition_capture()"), deploy.indexOf("validate_transition_files()"));
    expect(transitionCapture).toContain("current_database() AS database");
    expect(transitionCapture).toContain("pg_postmaster_start_time()::text AS \"clusterIdentity\"");
    expect(transitionCapture).toContain("AI_API_TRANSITION_EXPECTED_DATABASE");
    expect(transitionCapture).toContain("AI_API_TRANSITION_EXPECTED_SCHEMA");
    expect(transitionCapture).toContain("AI_API_TRANSITION_EXPECTED_CLUSTER_IDENTITY");
    // Bash suppresses errexit inside functions called from a conditional context,
    // so every capture/validation failure must explicitly die (proved by root runuser probe).
    expect(transitionCapture).toContain('capture "$release") > "$output" \\\n    || die "capture snapshot transition gagal"');
    expect(transitionCapture).toContain('[ -s "$output" ] || die "snapshot transition kosong"');
    const validateFiles = deploy.slice(deploy.indexOf("validate_transition_files()"), deploy.indexOf("quiesce_migration_writers()"));
    expect(validateFiles).toContain('"$mode" "$release" || die "validasi transition $mode gagal"');
    expect(deploy).not.toContain("AI API models must remain disabled after migration");
  });

  it("models legacy production indexes and foreign keys so rehearsal schema parity is exact", () => {
    expect(schema).toContain("@@index([status, autoAcceptAt])");
    expect(schema).toContain("pushSubscriptions           PushSubscription[]");
    expect(schema).toContain("pushJobs                    PushJob[]");
    expect(schema).toContain("user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)");
    expect(schema).toContain("user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)");
  });
});
