import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@riezz99.biz.id";
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

let configured = false;
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  configured = true;
}

export function isPushConfigured() { return configured; }
export function getVapidPublicKey() { return vapidPublicKey ?? null; }

export async function enqueuePush(input: { userId: string; dedupeKey: string; link: string; title?: string; body?: string; data?: Record<string, string> }) {
  if (!configured) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.pushJob.create({ data: { userId: input.userId, dedupeKey: input.dedupeKey, title: input.title ?? "Notifikasi Riezz99", body: input.body ?? "Ada aktivitas baru di akun kamu.", link: input.link, data: input.data } });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) return null;
      if (attempt === 2) console.error("Push queue enqueue failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  return null;
}

function isPrismaUniqueViolation(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }

function retryAt(attempts: number) { return new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.max(attempts - 1, 0))); }

async function claimJob() {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const candidate = await prisma.pushJob.findFirst({ where: { sentAt: null, availableAt: { lte: new Date() }, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] }, orderBy: { createdAt: "asc" } });
  if (!candidate) return null;
  const claimed = await prisma.pushJob.updateMany({ where: { id: candidate.id, sentAt: null, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] }, data: { lockedAt: new Date() } });
  return claimed.count ? candidate : null;
}

export async function drainPushQueue(limit = 20) {
  if (!configured) return { processed: 0, pending: 0 };
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const job = await claimJob();
    if (!job) break;
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: job.userId } });
    if (!subscriptions.length) {
      await prisma.pushJob.update({ where: { id: job.id }, data: { sentAt: new Date(), lockedAt: null, lastError: null } });
      processed += 1;
      continue;
    }
    let hadFailure = false;
    for (const subscription of subscriptions) {
      // Recheck ownership immediately before delivery so an old user job cannot
      // use an endpoint that was rebound during an account switch.
      const currentSubscription = await prisma.pushSubscription.findUnique({ where: { id: subscription.id } });
      if (!currentSubscription || currentSubscription.userId !== job.userId) continue;
      try {
        await webpush.sendNotification({ endpoint: currentSubscription.endpoint, keys: { p256dh: currentSubscription.p256dh, auth: currentSubscription.auth } }, JSON.stringify({ title: job.title, body: job.body, url: job.link, tag: job.dedupeKey, data: job.data ?? {} }), { TTL: 86_400 });
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
        if (statusCode === 404 || statusCode === 410) await prisma.pushSubscription.deleteMany({ where: { id: currentSubscription.id, userId: job.userId } });
        else hadFailure = true;
      }
    }
    const attempts = job.attempts + 1;
    await prisma.pushJob.update({ where: { id: job.id }, data: hadFailure && attempts < job.maxAttempts ? { attempts, availableAt: retryAt(attempts), lockedAt: null, lastError: "Push provider delivery failed" } : { attempts, sentAt: new Date(), lockedAt: null, lastError: hadFailure ? "Push provider delivery failed" : null } });
    processed += 1;
  }
  return { processed, pending: await prisma.pushJob.count({ where: { sentAt: null } }) };
}
