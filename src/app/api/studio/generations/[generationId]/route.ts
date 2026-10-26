import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deleteStudioFile } from "@/lib/studio/storage";

export const runtime = "nodejs";

type DeleteResult =
  | { kind: "ready" | "already-deleted"; storageKeys: string[]; claimedReferenceStorageKey: string | null }
  | { kind: "not-found" | "not-terminal"; storageKeys: []; claimedReferenceStorageKey: null };

const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

async function inspectAndClaimGeneration(userId: string, generationId: string): Promise<DeleteResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const generation = await tx.studioGeneration.findFirst({
          where: { id: generationId, userId },
          select: {
            status: true,
            deletedAt: true,
            deletionPendingAt: true,
            referenceStorageKey: true,
            outputs: { select: { storageKey: true } },
          },
        });
        if (!generation) return { kind: "not-found", storageKeys: [], claimedReferenceStorageKey: null };
        if (generation.status !== "COMPLETED" && generation.status !== "FAILED") return { kind: "not-terminal", storageKeys: [], claimedReferenceStorageKey: null };
        if (generation.deletedAt) {
          return {
            kind: "already-deleted",
            storageKeys: generation.outputs.map((output) => output.storageKey),
            claimedReferenceStorageKey: null,
          };
        }

        if (!generation.deletionPendingAt) {
          await tx.studioGeneration.update({
            where: { id: generationId },
            data: { deletionPendingAt: new Date() },
          });
        }

        let claimedReferenceStorageKey: string | null = null;
        if (generation.referenceStorageKey) {
          const otherActiveUses = await tx.studioGeneration.count({
            where: {
              id: { not: generationId },
              referenceStorageKey: generation.referenceStorageKey,
              deletedAt: null,
              deletionPendingAt: null,
            },
          });
          if (otherActiveUses === 0) {
            const reference = await tx.studioReference.findFirst({
              where: { userId, storageKey: generation.referenceStorageKey },
              select: { id: true, deletionPendingAt: true },
            });
            if (reference) {
              if (!reference.deletionPendingAt) {
                await tx.studioReference.update({
                  where: { id: reference.id },
                  data: { deletionPendingAt: new Date() },
                });
              }
              claimedReferenceStorageKey = generation.referenceStorageKey;
            }
          }
        }

        return {
          kind: "ready",
          storageKeys: [
            ...generation.outputs.map((output) => output.storageKey),
            ...(claimedReferenceStorageKey ? [claimedReferenceStorageKey] : []),
          ],
          claimedReferenceStorageKey,
        };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Generation gagal dihapus.");
}

async function finalizeGenerationDeletion(userId: string, generationId: string, claimedReferenceStorageKey: string | null): Promise<DeleteResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const generation = await tx.studioGeneration.findFirst({
          where: { id: generationId, userId },
          select: {
            status: true,
            deletedAt: true,
            referenceStorageKey: true,
            outputs: { select: { storageKey: true } },
          },
        });
        if (!generation) return { kind: "not-found", storageKeys: [], claimedReferenceStorageKey: null };
        if (generation.status !== "COMPLETED" && generation.status !== "FAILED") return { kind: "not-terminal", storageKeys: [], claimedReferenceStorageKey: null };

        if (claimedReferenceStorageKey && generation.referenceStorageKey === claimedReferenceStorageKey) {
          const otherActiveUses = await tx.studioGeneration.count({
            where: {
              id: { not: generationId },
              referenceStorageKey: claimedReferenceStorageKey,
              deletedAt: null,
              deletionPendingAt: null,
            },
          });
          if (otherActiveUses === 0) {
            const reference = await tx.studioReference.findFirst({
              where: { userId, storageKey: claimedReferenceStorageKey },
              select: { id: true },
            });
            if (reference) await tx.studioReference.delete({ where: { id: reference.id } });
          }
        }

        if (!generation.deletedAt) {
          await tx.studioGeneration.update({
            where: { id: generationId },
            data: {
              deletedAt: new Date(),
              deletionPendingAt: null,
              prompt: "[deleted by user]",
              referenceStorageKey: null,
              providerRequestId: null,
              errorCode: null,
              errorMessage: null,
            },
          });
        }
        await tx.studioGenerationOutput.deleteMany({ where: { generationId } });
        return {
          kind: generation.deletedAt ? "already-deleted" : "ready",
          storageKeys: generation.outputs.map((output) => output.storageKey),
          claimedReferenceStorageKey,
        };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (retryable(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Generation gagal dihapus.");
}

function deletionError(result: DeleteResult) {
  if (result.kind === "not-found") return NextResponse.json({ error: "Generation tidak ditemukan." }, { status: 404 });
  if (result.kind === "not-terminal") return NextResponse.json({ error: "Generation yang sedang diproses belum dapat dihapus." }, { status: 409 });
  return null;
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ generationId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { generationId } = await params;
  if (!generationId) return NextResponse.json({ error: "Generation tidak ditemukan." }, { status: 404 });

  try {
    const candidate = await inspectAndClaimGeneration(session.user.id, generationId);
    const candidateError = deletionError(candidate);
    if (candidateError) return candidateError;

    await Promise.all(candidate.storageKeys.map((storageKey) => deleteStudioFile(storageKey)));

    const finalized = await finalizeGenerationDeletion(session.user.id, generationId, candidate.claimedReferenceStorageKey);
    const finalizedError = deletionError(finalized);
    if (finalizedError) return finalizedError;
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Generation gagal dihapus." }, { status: 500 });
  }
}
