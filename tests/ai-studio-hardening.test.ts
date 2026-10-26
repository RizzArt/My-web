import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("AI Studio hardening", () => {
  it("uses a shared serializable PostgreSQL rate limiter with cleanup", () => {
    const source = read("src/lib/studio/rate-limit.ts");
    expect(source).toContain("studioRateLimit"); expect(source).toContain('isolationLevel: "Serializable"'); expect(source).toContain("cleanupStudioRateLimits"); expect(source).toContain("STUDIO_RATE_LIMIT = 6");
  });
  it("keeps generation debit and refund idempotent", () => {
    const source = read("src/lib/studio/service.ts");
    expect(source).toContain('type: "GENERATION_DEBIT"'); expect(source).toContain('generationId_type'); expect(source).toContain('type: "GENERATION_REFUND"'); expect(source).toContain('isolationLevel: "Serializable"');
  });
  it("removes uncommitted outputs and preserves database-referenced files", () => {
    const service = read("src/lib/studio/service.ts"), reconcile = read("src/lib/studio/reconcile.ts");
    expect(service).toContain("deleteStudioFile(output.storageKey)"); expect(reconcile).toContain("new Set([...outputs, ...references]"); expect(reconcile).toContain("dryRun = true");
  });
  it("rejects Leonardo placeholder/non-UUID model activation and keeps downloads private", () => {
    const admin = read("src/app/api/admin/studio/route.ts"), output = read("src/app/api/studio/outputs/[outputId]/route.ts"), history = read("src/app/api/studio/generations/route.ts");
    expect(admin).toContain("leonardoModelId"); expect(admin).toContain("uuid()"); expect(output).toContain("generation: { userId: session.user.id, deletedAt: null }"); expect(history).toContain("where: { userId: session.user.id, deletedAt: null }");
  });
  it("seeds all production providers disabled and keeps deployment smoke provider-free", () => {
    const migration = read("prisma/migrations/20261004000000_ai_studio/migration.sql"), deploy = read("deployment/ai-studio-deploy.sh");
    expect(migration).toContain("'GEMINI', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', false");
    expect(migration).toContain("'LEONARDO', 'CHANGE_ME_LEONARDO_MODEL_ID', 'Leonardo Image', false");
    const sekai = read("prisma/migrations/20261011000000_add_sekai_gateway/migration.sql");
    const griphub = read("prisma/migrations/20261021220000_add_griphub_studio_disabled/migration.sql");
    const providerRules = read("src/lib/studio/providers/types.ts");
    const adminStudio = read("src/app/api/admin/studio/route.ts");
    expect(sekai).toContain("ON CONFLICT (\"provider\", \"model\") DO NOTHING"); expect(sekai.match(/'SEKAI'/g)).toHaveLength(3); expect(sekai).toContain("false, 1, false, '[\"1:1\"]'");
    expect(griphub).toContain("'GRIPHUB', 'gpt-image', 'GPT Image'");
    expect(griphub).toContain("'GRIPHUB', 'gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'");
    expect(griphub).toContain("false, 17, false, '[\"1:1\", \"3:2\", \"2:3\"]'");
    expect(griphub).toContain("false, 13, false, '[\"1:1\", \"3:2\", \"2:3\"]'");
    expect(providerRules).toContain("GRIPHUB");
    expect(adminStudio).toContain("GRIPHUB image belum dapat diaktifkan");
    expect(deploy).toContain("provider smoke dilewati"); expect(deploy).not.toContain("generativelanguage.googleapis.com"); expect(deploy).not.toContain("cloud.leonardo.ai"); expect(deploy).not.toContain("api.sekaigateway.xyz");
  });
});
