import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const STUDIO_RATE_LIMIT = 6;
export const STUDIO_RATE_WINDOW_MS = 60_000;
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002");
function windowStart(now = new Date()) { return new Date(Math.floor(now.getTime() / STUDIO_RATE_WINDOW_MS) * STUDIO_RATE_WINDOW_MS); }

// PostgreSQL serializable transactions coordinate the limit across all workers.
export async function assertStudioRateLimit(userId: string, now = new Date()) {
  const start = windowStart(now);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.studioRateLimit.findUnique({ where: { userId_windowStart: { userId, windowStart: start } }, select: { id: true, count: true } });
        if (current && current.count >= STUDIO_RATE_LIMIT) throw new Error("Terlalu banyak permintaan. Coba lagi dalam satu menit.");
        if (current) await tx.studioRateLimit.update({ where: { id: current.id }, data: { count: { increment: 1 } } });
        else await tx.studioRateLimit.create({ data: { userId, windowStart: start, count: 1 } });
      }, { isolationLevel: "Serializable" });
      break;
    } catch (error) { if (retryable(error) && attempt < 2) continue; throw error; }
  }
  if (now.getMinutes() % 10 === 0) await cleanupStudioRateLimits(now);
}

export async function cleanupStudioRateLimits(now = new Date()) {
  return prisma.studioRateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
}
