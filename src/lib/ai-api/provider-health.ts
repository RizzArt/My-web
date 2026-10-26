import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SekaiProviderHealthProbe } from "./providers/sekai-health";
import { customerBillingProviderAdmitted } from "./provider-policy";

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
export type AiApiHealthModel = { id: string; publicId: string; provider: string; enabled: boolean; breakerState: BreakerState; consecutiveFailures: number; safeReasonCode: string | null; hasUnresolvedRequests: boolean };
export type AiApiHealthStore = {
  listModels(): Promise<AiApiHealthModel[]>;
  requiredProviderBalanceRupiah(now: Date): Promise<number>;
  nextPriceBoundary(now: Date): Promise<Date | null>;
  renew(modelId: string, now: Date, healthyUntil: Date): Promise<boolean>;
  recover(modelId: string, now: Date, healthyUntil: Date): Promise<boolean>;
  open(modelId: string, reasonCode: string, now: Date): Promise<boolean>;
  transientFailure(modelId: string, reasonCode: string, now: Date): Promise<{ changed: boolean; opened: boolean }>;
};

type Probe = (minimumPaygBalanceRupiah: number) => Promise<SekaiProviderHealthProbe>;
const DEFAULT_WINDOW_SECONDS = 300;
const DEFAULT_MINIMUM_PAYG_BALANCE_RUPIAH = 1_000;
const TRANSIENT_FAILURE_LIMIT = 3;
const MICROS_PER_RUPIAH = BigInt(1_000_000);
const AI_API_PROVIDER_ADVISORY_LOCK = BigInt("824220260116");

type AdvisoryLockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function acquireAiApiProviderAdmissionLock(tx: AdvisoryLockClient) {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${AI_API_PROVIDER_ADVISORY_LOCK})`;
  if (rows[0]?.locked !== true) throw new Error("AI API provider admission lock gagal.");
}

async function tryAcquireAiApiProviderAdmissionLock(tx: AdvisoryLockClient) {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${AI_API_PROVIDER_ADVISORY_LOCK}) AS locked`;
  return rows[0]?.locked === true;
}

type AiApiHealthRate = { upstreamInput: bigint; upstreamOutput: bigint; retailInput: bigint; retailOutput: bigint };

export function calculateRequiredPaygBalanceRupiah(totalLiabilityMicros: bigint, rates: AiApiHealthRate[]) {
  if (totalLiabilityMicros < BigInt(0)) throw new Error("AI API liability tidak valid.");
  let numerator = BigInt(0);
  let denominator = BigInt(1);
  for (const rate of rates) {
    for (const [upstream, retail] of [[rate.upstreamInput, rate.retailInput], [rate.upstreamOutput, rate.retailOutput]] as const) {
      if (upstream < BigInt(0) || retail <= BigInt(0)) throw new Error("AI API price ratio tidak valid.");
      const divisor = greatestCommonDivisor(upstream, retail);
      const reducedUpstream = upstream / divisor;
      const reducedRetail = retail / divisor;
      if (reducedUpstream * denominator > numerator * reducedRetail) { numerator = reducedUpstream; denominator = reducedRetail; }
    }
  }
  if (totalLiabilityMicros === BigInt(0) || numerator === BigInt(0)) return 0;
  const combinedDenominator = denominator * MICROS_PER_RUPIAH;
  const product = totalLiabilityMicros * numerator;
  const requiredRupiah = ((product - BigInt(1)) / combinedDenominator) + BigInt(1);
  if (requiredRupiah > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("AI API provider liability melampaui batas aman.");
  return Number(requiredRupiah);
}

function greatestCommonDivisor(left: bigint, right: bigint) {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a === BigInt(0) ? BigInt(1) : a;
}

export function healthLeaseUntil(now: Date, boundary: Date | null, seconds = DEFAULT_WINDOW_SECONDS) {
  const configured = new Date(now.getTime() + seconds * 1_000);
  return boundary && boundary < configured ? boundary : configured;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (!value || !/^\d{1,10}$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function aiApiHealthMonitorConfig() {
  return {
    intervalSeconds: 60,
    healthWindowSeconds: DEFAULT_WINDOW_SECONDS,
    minimumPaygBalanceRupiah: boundedInteger(process.env.SEKAI_MIN_PAYG_BALANCE_RUPIAH, DEFAULT_MINIMUM_PAYG_BALANCE_RUPIAH, 0, 1_000_000_000),
    transientFailureLimit: TRANSIENT_FAILURE_LIMIT,
  };
}

type HealthPrismaClient = Pick<Prisma.TransactionClient, "aiApiModel" | "aiApiRequest" | "aiApiWallet" | "aiApiPriceVersion" | "aiApiProviderHealth" | "studioGeneration">;

function createPrismaStore(client: HealthPrismaClient): AiApiHealthStore {
  return {
  async listModels() {
    const [rows, unresolved] = await Promise.all([
      client.aiApiModel.findMany({ select: { id: true, publicId: true, provider: true, enabled: true, providerHealth: { select: { breakerState: true, consecutiveFailures: true, safeReasonCode: true } } }, orderBy: { publicId: "asc" } }),
      client.aiApiRequest.groupBy({ by: ["modelId"], where: { status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } }, _count: { _all: true } }),
    ]);
    const unresolvedIds = new Set(unresolved.filter((row) => row._count._all > 0).map((row) => row.modelId));
    return rows.map((row) => ({ id: row.id, publicId: row.publicId, provider: row.provider, enabled: row.enabled, breakerState: row.providerHealth?.breakerState ?? "OPEN", consecutiveFailures: row.providerHealth?.consecutiveFailures ?? 0, safeReasonCode: row.providerHealth?.safeReasonCode ?? null, hasUnresolvedRequests: unresolvedIds.has(row.id) }));
  },
  async requiredProviderBalanceRupiah(now) {
    const [wallets, prices] = await Promise.all([
      client.aiApiWallet.aggregate({ _sum: { availableMicros: true, reservedMicros: true } }),
      client.aiApiPriceVersion.findMany({
        where: { model: { enabled: true }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        select: { upstreamInputMicrosPerMillion: true, upstreamOutputMicrosPerMillion: true, retailInputMicrosPerMillion: true, retailOutputMicrosPerMillion: true },
      }),
    ]);
    const totalLiabilityMicros = (wallets._sum.availableMicros ?? BigInt(0)) + (wallets._sum.reservedMicros ?? BigInt(0));
    return calculateRequiredPaygBalanceRupiah(totalLiabilityMicros, prices.map((price) => ({
      upstreamInput: price.upstreamInputMicrosPerMillion,
      upstreamOutput: price.upstreamOutputMicrosPerMillion,
      retailInput: price.retailInputMicrosPerMillion,
      retailOutput: price.retailOutputMicrosPerMillion,
    })));
  },
  async nextPriceBoundary(now) {
    const [nextStart, nextEnd] = await Promise.all([
      client.aiApiPriceVersion.findFirst({ where: { model: { enabled: true }, effectiveFrom: { gt: now } }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } }),
      client.aiApiPriceVersion.findFirst({ where: { model: { enabled: true }, effectiveTo: { gt: now } }, orderBy: { effectiveTo: "asc" }, select: { effectiveTo: true } }),
    ]);
    const candidates = [nextStart?.effectiveFrom, nextEnd?.effectiveTo].filter((value): value is Date => Boolean(value));
    return candidates.length > 0 ? new Date(Math.min(...candidates.map((value) => value.getTime()))) : null;
  },
  async renew(modelId, now, healthyUntil) {
    const changed = await client.aiApiProviderHealth.updateMany({
      where: { modelId, breakerState: "CLOSED", model: { enabled: true } },
      data: { healthyUntil, consecutiveFailures: 0, lastSuccessAt: now, safeReasonCode: null },
    });
    return changed.count === 1;
  },
  async recover(modelId, now, healthyUntil) {
    const changed = await client.aiApiProviderHealth.updateMany({
      where: {
        modelId,
        breakerState: "OPEN",
        safeReasonCode: { startsWith: "AUTO_HEALTH_" },
        model: {
          enabled: true,
          requests: { none: { status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } } },
        },
      },
      data: { breakerState: "CLOSED", healthyUntil, consecutiveFailures: 0, lastSuccessAt: now, safeReasonCode: null },
    });
    return changed.count === 1;
  },
  async open(modelId, reasonCode, now) {
    const changed = await client.aiApiProviderHealth.updateMany({
      where: { modelId, breakerState: "CLOSED", model: { enabled: true } },
      data: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: { increment: 1 }, safeReasonCode: reasonCode, updatedAt: now },
    });
    return changed.count === 1;
  },
  async transientFailure(modelId, reasonCode, now) {
    const changed = await client.aiApiProviderHealth.updateMany({
      where: { modelId, breakerState: "CLOSED", model: { enabled: true } },
      data: { consecutiveFailures: { increment: 1 }, safeReasonCode: reasonCode, updatedAt: now },
    });
    if (changed.count !== 1) return { changed: false, opened: false };
    const opened = await client.aiApiProviderHealth.updateMany({
      where: { modelId, breakerState: "CLOSED", consecutiveFailures: { gte: TRANSIENT_FAILURE_LIMIT }, model: { enabled: true } },
      data: { breakerState: "OPEN", healthyUntil: null, safeReasonCode: "AUTO_HEALTH_REPEATED_FAILURE", updatedAt: now },
    });
    return { changed: true, opened: opened.count === 1 };
  },
  };
}

const prismaStore = createPrismaStore(prisma);

function defaultProbe(): Promise<SekaiProviderHealthProbe> {
  // A future retained-provider contract needs its own reviewed probe adapter.
  // Never reuse the retired API provider or the separate Studio credential.
  return Promise.resolve({ ok: false, hard: true, reasonCode: "AUTO_HEALTH_PROVIDER_CONTRACT_UNVERIFIED" });
}

export async function refreshAiApiProviderHealth(input: { now?: Date; store?: AiApiHealthStore; probe?: Probe } = {}) {
  const now = input.now ?? new Date();
  const store = input.store ?? prismaStore;
  const config = aiApiHealthMonitorConfig();
  const models = await store.listModels();
  const eligible = models.filter((model) => customerBillingProviderAdmitted(model.provider) && model.enabled && (model.breakerState === "CLOSED" || (model.breakerState === "OPEN" && model.safeReasonCode?.startsWith("AUTO_HEALTH_") && !model.hasUnresolvedRequests)));
  if (eligible.length === 0) return { ok: true as const, checked: 0, renewed: 0, recovered: 0, opened: 0, transientFailures: 0, skipped: models.length };

  const [providerExposureRupiah, nextPriceBoundary] = await Promise.all([
    store.requiredProviderBalanceRupiah(now),
    store.nextPriceBoundary(now),
  ]);
  const minimumPaygBalanceRupiah = Math.max(config.minimumPaygBalanceRupiah, providerExposureRupiah);
  const probe = await (input.probe ?? defaultProbe)(minimumPaygBalanceRupiah);
  let renewed = 0;
  let recovered = 0;
  let opened = 0;
  let unavailable = 0;
  let transientFailures = 0;
  let skipped = models.length - eligible.length;

  if (!probe.ok) {
    for (const model of eligible) {
      if (model.breakerState !== "CLOSED") { skipped += 1; continue; }
      if (probe.hard) {
        if (await store.open(model.id, probe.reasonCode, now)) opened += 1;
        else skipped += 1;
      } else {
        const result = await store.transientFailure(model.id, probe.reasonCode, now);
        if (result.changed) transientFailures += 1;
        else skipped += 1;
        if (result.opened) opened += 1;
      }
    }
    return { ok: false as const, checked: eligible.length, renewed, recovered, opened, transientFailures, skipped, reasonCode: probe.reasonCode, minimumPaygBalanceRupiah };
  }

  const listed = new Set(probe.modelIds);
  const entitled = probe.entitledModelIds ? new Set(probe.entitledModelIds) : null;
  const healthyUntil = healthLeaseUntil(now, nextPriceBoundary, config.healthWindowSeconds);
  for (const model of eligible) {
    if (!listed.has(model.publicId) || (entitled && !entitled.has(model.publicId))) {
      unavailable += 1;
      if (model.breakerState === "CLOSED" && await store.open(model.id, "AUTO_HEALTH_MODEL_MISSING", now)) opened += 1;
      else skipped += 1;
      continue;
    }
    if (model.breakerState === "OPEN") {
      if (await store.recover(model.id, now, healthyUntil)) recovered += 1;
      else skipped += 1;
    } else if (await store.renew(model.id, now, healthyUntil)) renewed += 1;
    else skipped += 1;
  }
  return {
    ok: unavailable === 0,
    checked: eligible.length,
    renewed,
    recovered,
    opened,
    transientFailures,
    skipped,
    paygBalanceRupiah: probe.paygBalanceRupiah,
    minimumPaygBalanceRupiah,
    ...(unavailable > 0 ? { reasonCode: "AUTO_HEALTH_MODEL_MISSING" } : {}),
  };
}

export async function runAiApiProviderHealthJob() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (!await tryAcquireAiApiProviderAdmissionLock(tx)) return { ok: true as const, checked: 0, renewed: 0, recovered: 0, opened: 0, transientFailures: 0, skipped: 0, skippedConcurrent: true as const };
        const [providerWideBusy, sharedSekaiStudioBusy] = await Promise.all([
          tx.aiApiRequest.count({ where: { status: { in: ["DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } } }),
          tx.studioGeneration.count({ where: { provider: "SEKAI", status: "PROCESSING" } }),
        ]);
        if (providerWideBusy > 0 || sharedSekaiStudioBusy > 0) return { ok: true as const, checked: 0, renewed: 0, recovered: 0, opened: 0, transientFailures: 0, skipped: 0, skippedProviderBusy: true as const };
        return refreshAiApiProviderHealth({ store: createPrismaStore(tx) });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Konflik health monitor AI API.");
}
