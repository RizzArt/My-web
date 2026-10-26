import { prisma } from "@/lib/prisma";
import { deleteStudioFile, listStudioFiles } from "./storage";

export async function reconcileStudioFiles({ dryRun = true } = {}) {
  const [outputs, references, files] = await Promise.all([
    prisma.studioGenerationOutput.findMany({ select: { storageKey: true } }),
    prisma.studioReference.findMany({ select: { storageKey: true } }),
    listStudioFiles(),
  ]);
  const live = new Set([...outputs, ...references].map((item) => item.storageKey));
  const orphans = files.filter((key) => !live.has(key));
  if (!dryRun) await Promise.all(orphans.map(deleteStudioFile));
  return { dryRun, scanned: files.length, retained: files.length - orphans.length, orphans, removed: dryRun ? 0 : orphans.length };
}
