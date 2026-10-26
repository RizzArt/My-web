import { Prisma, type StudioGeneration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { acquireAiApiProviderAdmissionLock } from "@/lib/ai-api/provider-health";
import { getStudioProvider } from "./providers";
import { SekaiProviderError } from "./providers/sekai";
import { assertStudioProviderRequest } from "./providers/types";
import { deleteStudioFile, readStudioFile, saveStudioOutput } from "./storage";

const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
class StudioGenerationAlreadyClaimedError extends Error {}

function generationFailureMessage(error: unknown) {
  return error instanceof SekaiProviderError ? error.safeMessage : "Generation gagal diproses.";
}

export function logSekaiProviderFailure(generationId: string, model: string, error: SekaiProviderError) {
  console.error("AI Studio SEKAI provider failed", {
    generationId,
    model,
    attempt: error.attempt,
    ...(error.status !== undefined ? { status: error.status } : {}),
    category: error.category,
    ...(error.providerRequestId ? { providerRequestId: error.providerRequestId } : {}),
  });
}

export async function createStudioGeneration(input: { userId: string; provider: string; model: string; prompt: string; aspectRatio: string; outputCount: number; referenceStorageKey?: string }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        assertStudioProviderRequest(input.provider, input);
        const config = await tx.studioModelConfig.findFirst({ where: { provider: input.provider, model: input.model, isEnabled: true } });
        if (!config) throw new Error("Provider atau model ini sedang tidak tersedia.");
        const ratios = config.supportedAspectRatios as unknown;
        if (!Array.isArray(ratios) || !ratios.includes(input.aspectRatio)) throw new Error("Aspect ratio tidak didukung model ini.");
        if (input.referenceStorageKey && !config.supportsReferenceImage) throw new Error("Model ini tidak mendukung reference image.");
        if (input.referenceStorageKey && !await tx.studioReference.findFirst({ where: { userId: input.userId, storageKey: input.referenceStorageKey, deletionPendingAt: null }, select: { id: true } })) throw new Error("Reference gambar tidak ditemukan.");
        const cost = config.creditCostPerImage * input.outputCount;
        const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { studioCredits: true } });
        if (user.studioCredits < cost) throw new Error("Studio credit tidak mencukupi.");
        const generation = await tx.studioGeneration.create({ data: { userId: input.userId, modelConfigId: config.id, provider: config.provider, model: config.model, prompt: input.prompt, aspectRatio: input.aspectRatio, outputCount: input.outputCount, referenceStorageKey: input.referenceStorageKey, creditCost: cost } });
        const balanceAfter = user.studioCredits - cost;
        await tx.user.update({ where: { id: input.userId }, data: { studioCredits: balanceAfter } });
        await tx.studioCreditTransaction.create({ data: { userId: input.userId, generationId: generation.id, type: "GENERATION_DEBIT", amount: -cost, balanceBefore: user.studioCredits, balanceAfter, description: `AI Studio generation ${generation.id}` } });
        return generation;
      }, { isolationLevel: "Serializable" });
    } catch (error) { if (retryable(error) && attempt < 2) continue; throw error; }
  }
  throw new Error("Gagal membuat generation.");
}

async function refundGeneration(generationId: string, reason: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const generation = await tx.studioGeneration.findUniqueOrThrow({ where: { id: generationId } });
        const existing = await tx.studioCreditTransaction.findUnique({ where: { generationId_type: { generationId, type: "GENERATION_REFUND" } } });
        if (!existing) {
          const user = await tx.user.findUniqueOrThrow({ where: { id: generation.userId }, select: { studioCredits: true } });
          const balanceAfter = user.studioCredits + generation.creditCost;
          await tx.user.update({ where: { id: generation.userId }, data: { studioCredits: balanceAfter } });
          await tx.studioCreditTransaction.create({ data: { userId: generation.userId, generationId, type: "GENERATION_REFUND", amount: generation.creditCost, balanceBefore: user.studioCredits, balanceAfter, description: `Refund AI Studio: ${reason}` } });
        }
        await tx.studioGeneration.update({ where: { id: generationId }, data: { status: "FAILED", errorCode: "PROVIDER_FAILED", errorMessage: reason.slice(0, 500) } });
      }, { isolationLevel: "Serializable" });
      return;
    } catch (error) { if (retryable(error) && attempt < 2) continue; throw error; }
  }
}

export async function processStudioGeneration(generationId: string) {
  let generation: StudioGeneration | null = null;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        generation = await prisma.$transaction(async (tx) => {
          await acquireAiApiProviderAdmissionLock(tx);
          const pending = await tx.studioGeneration.findUniqueOrThrow({ where: { id: generationId } });
          if (pending.status !== "PENDING") throw new StudioGenerationAlreadyClaimedError("Generation sudah diproses worker lain.");
          if (pending.provider === "SEKAI") {
            const sharedAiApiBusy = await tx.aiApiRequest.count({ where: { status: { in: ["DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } } });
            if (sharedAiApiBusy > 0) throw new Error("Provider sedang menyelesaikan request API; coba generation lagi nanti.");
            await tx.aiApiProviderHealth.updateMany({
              where: { breakerState: "CLOSED", model: { enabled: true } },
              data: { breakerState: "OPEN", healthyUntil: null, consecutiveFailures: 0, safeReasonCode: "AUTO_HEALTH_SHARED_PROVIDER_ACTIVITY" },
            });
          }
          const claimed = await tx.studioGeneration.updateMany({ where: { id: generationId, status: "PENDING" }, data: { status: "PROCESSING" } });
          if (claimed.count !== 1) throw new StudioGenerationAlreadyClaimedError("Generation sudah diproses worker lain.");
          return tx.studioGeneration.findUniqueOrThrow({ where: { id: generationId } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
        break;
      } catch (error) {
        const retryTransition = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!retryTransition || attempt === 2) throw error;
      }
    }
    if (!generation) throw new Error("Generation gagal masuk antrean provider.");
    const referenceImage = generation.referenceStorageKey ? await readStudioFile(generation.referenceStorageKey) : undefined;
    const response = await getStudioProvider(generation.provider).generate({ model: generation.model, prompt: generation.prompt, aspectRatio: generation.aspectRatio, outputCount: generation.outputCount, referenceImage });
    const outputs = await Promise.all(response.images.map((image) => saveStudioOutput(image.data, image.mimeType)));
    try {
      await prisma.$transaction(async (tx) => {
        await tx.studioGenerationOutput.createMany({ data: outputs.map((output, position) => ({ generationId, ...output, position })) });
        await tx.studioGeneration.update({ where: { id: generationId }, data: { status: "COMPLETED", providerRequestId: response.providerRequestId, completedAt: new Date() } });
      });
    } catch (error) {
      await Promise.all(outputs.map((output) => deleteStudioFile(output.storageKey)));
      throw error;
    }
  } catch (error) {
    if (error instanceof StudioGenerationAlreadyClaimedError) return;
    if (generation && error instanceof SekaiProviderError) logSekaiProviderFailure(generationId, generation.model, error);
    await refundGeneration(generationId, generationFailureMessage(error));
  }
}

export async function creditStudioUser(userId: string, amount: number, description: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { studioCredits: true } });
    const balanceAfter = user.studioCredits + amount;
    if (balanceAfter < 0) throw new Error("Credit tidak boleh negatif.");
    await tx.user.update({ where: { id: userId }, data: { studioCredits: balanceAfter } });
    return tx.studioCreditTransaction.create({ data: { userId, type: "ADMIN_CREDIT", amount, balanceBefore: user.studioCredits, balanceAfter, description } });
  }, { isolationLevel: "Serializable" });
}
