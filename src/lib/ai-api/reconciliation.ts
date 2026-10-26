import { prisma } from "@/lib/prisma";
import { AiApiError, markAiApiReconciliationRequired, releaseAiApiRequest } from "./service";
import { authenticateAiApiResponseReplay } from "./response-replay";

const RESERVED_STALE_MS = 5 * 60_000;
const MAX_BATCH = 100;

export async function reconcileStaleAiApiRequests(now = new Date()) {
  const reservedBefore = new Date(now.getTime() - RESERVED_STALE_MS);
  const [reserved, dispatching, terminalReview] = await Promise.all([
    prisma.aiApiRequest.findMany({
      where: { status: "RESERVED", createdAt: { lte: reservedBefore } },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: MAX_BATCH,
    }),
    prisma.aiApiRequest.findMany({
      where: {
        status: "DISPATCHING",
        OR: [
          { concurrencyLease: { expiresAt: { lte: now } } },
          { concurrencyLease: null },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: MAX_BATCH,
    }),
    prisma.aiApiRequest.findMany({
      where: { status: { in: ["RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] }, concurrencyLease: { releasedAt: null } },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: MAX_BATCH,
    }),
  ]);

  let released = 0;
  let reconciliationRequired = 0;
  let leasesReleased = 0;
  let failed = 0;
  const deferFailure = async (id: string) => {
    try {
      await prisma.aiApiRequest.updateMany({ where: { id, status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } }, data: { safeErrorCode: "RECOVERY_ATTEMPT_FAILED", updatedAt: now } });
    } catch { /* the job reports failure; a later run retries */ }
  };

  for (const request of reserved) {
    try {
      const result = await releaseAiApiRequest(request.id, "STALE_PRE_DISPATCH_RESERVATION", now, { openBreaker: false, expectedStatus: "RESERVED" });
      if (!result.duplicate) released += 1;
    } catch (error) {
      if (error instanceof AiApiError && error.code === "invalid_request_state") continue;
      failed += 1;
      await deferFailure(request.id);
    }
  }

  for (const request of dispatching) {
    try {
      await markAiApiReconciliationRequired(request.id, "STALE_DISPATCH_OUTCOME", { openBreaker: true, now });
      reconciliationRequired += 1;
    } catch {
      failed += 1;
      await deferFailure(request.id);
    }
  }

  for (const request of terminalReview) {
    try {
      const changed = await prisma.aiApiConcurrencyLease.updateMany({ where: { requestId: request.id, releasedAt: null }, data: { releasedAt: now } });
      leasesReleased += changed.count;
    } catch {
      failed += 1;
      await deferFailure(request.id);
    }
  }

  let ingressLeasesReleased = 0;
  let responseReplaysPurged = 0;
  try {
    const expiredIngress = await prisma.aiApiIngressLease.updateMany({ where: { releasedAt: null, expiresAt: { lte: now } }, data: { releasedAt: now } });
    ingressLeasesReleased = expiredIngress.count;
  } catch {
    failed += 1;
  }

  const expiredReplays = await prisma.aiApiRequest.findMany({
    where: { responseReplayExpiresAt: { lte: now }, responseReplayCiphertext: { not: null } },
    select: { id: true, apiKeyId: true, walletId: true, endpoint: true, requestFingerprint: true, responseReplayCiphertext: true, responseReplayExpiresAt: true },
    orderBy: [{ updatedAt: "asc" }, { responseReplayExpiresAt: "asc" }],
    take: MAX_BATCH,
  });
  for (const replay of expiredReplays) {
    try {
      if (!replay.responseReplayCiphertext || !replay.responseReplayExpiresAt) throw new Error("Replay respons tidak tersedia.");
      authenticateAiApiResponseReplay(replay.responseReplayCiphertext, replay.responseReplayExpiresAt, {
        requestId: replay.id,
        apiKeyId: replay.apiKeyId,
        walletId: replay.walletId,
        endpoint: replay.endpoint,
        requestFingerprint: replay.requestFingerprint,
      });
      const purged = await prisma.aiApiRequest.updateMany({
        where: { id: replay.id, responseReplayCiphertext: replay.responseReplayCiphertext, responseReplayExpiresAt: replay.responseReplayExpiresAt },
        data: { responseReplayCiphertext: null, responseReplayExpiresAt: null },
      });
      responseReplaysPurged += purged.count;
    } catch {
      failed += 1;
      try {
        await prisma.aiApiRequest.updateMany({
          where: { id: replay.id, responseReplayCiphertext: replay.responseReplayCiphertext, responseReplayExpiresAt: replay.responseReplayExpiresAt },
          data: { updatedAt: now },
        });
      } catch { /* the failed row remains evidence and the job still reports failure */ }
    }
  }

  const summary = { checked: reserved.length + dispatching.length + terminalReview.length, released, reconciliationRequired, leasesReleased, ingressLeasesReleased, responseReplaysPurged, failed };
  if (failed > 0) return { ...summary, ok: false as const };
  return { ...summary, ok: true as const };
}
