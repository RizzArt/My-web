import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createAiApiKeyForUser } from "@/lib/ai-api/admin";
import { verifyFreshAdminMfa } from "@/lib/admin-mfa-service";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";
import { requireActiveAdmin } from "@/lib/active-admin";

const input = z.object({
  userId: z.string().min(1), name: z.string().trim().min(1).max(100), rateLimitPerMinute: z.number().int().min(1).max(10_000).default(60), concurrencyLimit: z.number().int().min(1).max(100).default(2), dailySpendLimitRupiah: z.string().regex(/^\d{1,10}$/).default("100000"), expiresAt: z.string().datetime().optional(), mfaCode: z.string().trim().min(6).max(128),
}).strict();
const idempotencyPattern = /^[A-Za-z0-9._:+/-]{8,200}$/;

export async function GET() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!await requireActiveAdmin(session.user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  const wallets = await prisma.aiApiWallet.findMany({ select: { id: true, userId: true, availableMicros: true, reservedMicros: true, isFrozen: true, user: { select: { email: true } }, keys: { select: { id: true, name: true, prefix: true, status: true, expiresAt: true, rateLimitPerMinute: true, concurrencyLimit: true, dailySpendLimitMicros: true, createdAt: true }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ wallets: wallets.map((wallet) => ({ ...wallet, availableMicros: wallet.availableMicros.toString(), reservedMicros: wallet.reservedMicros.toString(), keys: wallet.keys.map((key) => ({ ...key, dailySpendLimitMicros: key.dailySpendLimitMicros.toString() })) })) }, { headers: sensitiveJsonHeaders });
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const idempotency = request.headers.get("Idempotency-Key");
  if (!idempotency || !idempotencyPattern.test(idempotency)) return NextResponse.json({ error: "Idempotency-Key tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  if (!await verifyFreshAdminMfa(session.user.id, parsed.data.mfaCode)) return NextResponse.json({ error: "MFA admin diperlukan untuk menerbitkan API key." }, { status: 403, headers: sensitiveJsonHeaders });
  try {
    const expiry = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined;
    if (expiry && expiry <= new Date()) return NextResponse.json({ error: "Masa berlaku API key harus di masa depan." }, { status: 400, headers: sensitiveJsonHeaders });
    const key = await createAiApiKeyForUser({ actorId: session.user.id, userId: parsed.data.userId, name: parsed.data.name, rateLimitPerMinute: parsed.data.rateLimitPerMinute, concurrencyLimit: parsed.data.concurrencyLimit, dailySpendLimitMicros: BigInt(parsed.data.dailySpendLimitRupiah) * BigInt(1_000_000), expiresAt: expiry, issuanceEventKey: `admin-key:${session.user.id}:${idempotency}` });
    return NextResponse.json({ key, warning: "Simpan plaintext sekarang. Nilai ini tidak dapat ditampilkan kembali." }, { status: 201, headers: sensitiveJsonHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "API key gagal dibuat." }, { status: 409, headers: sensitiveJsonHeaders });
  }
}
