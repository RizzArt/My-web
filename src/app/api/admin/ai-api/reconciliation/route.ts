import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { settleAiApiRequestByAdmin } from "@/lib/ai-api/admin";
import { verifyFreshAdminMfa } from "@/lib/admin-mfa-service";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";
import { requireActiveAdmin } from "@/lib/active-admin";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RELEASE_UNBILLED"), requestId: z.string().min(1), reason: z.string().trim().min(3).max(300), unbilledEvidenceReference: z.string().regex(/^[A-Za-z0-9._:/-]{8,300}$/), mfaCode: z.string().trim().min(6).max(128) }).strict(),
  z.object({ action: z.literal("FINALIZE_USAGE"), requestId: z.string().min(1), reason: z.string().trim().min(3).max(300), providerRequestId: z.string().regex(/^[A-Za-z0-9._:/-]{1,200}$/).optional(), mfaCode: z.string().trim().min(6).max(128) }).strict(),
]);

export async function GET() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!await requireActiveAdmin(session.user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  const requests = await prisma.aiApiRequest.findMany({
    where: { status: { in: ["RESERVED", "DISPATCHING", "RECONCILIATION_REQUIRED", "MANUAL_REVIEW"] } },
    select: { id: true, status: true, reservedMicros: true, promptTokens: true, completionTokens: true, safeErrorCode: true, providerRequestId: true, upstreamIdempotencyKey: true, createdAt: true, updatedAt: true, model: { select: { publicId: true } }, apiKey: { select: { prefix: true, wallet: { select: { userId: true } } } } },
    orderBy: { updatedAt: "asc" },
    take: 500,
  });
  return NextResponse.json({ requests: requests.map((request) => ({ ...request, reservedMicros: request.reservedMicros.toString(), promptTokens: request.promptTokens?.toString() ?? null, completionTokens: request.completionTokens?.toString() ?? null })) }, { headers: sensitiveJsonHeaders });
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  if (!await verifyFreshAdminMfa(session.user.id, parsed.data.mfaCode)) return NextResponse.json({ error: "MFA admin diperlukan untuk settlement." }, { status: 403, headers: sensitiveJsonHeaders });
  try {
    const result = parsed.data.action === "RELEASE_UNBILLED"
      ? await settleAiApiRequestByAdmin({ actorId: session.user.id, ...parsed.data })
      : await settleAiApiRequestByAdmin({ actorId: session.user.id, ...parsed.data });
    return NextResponse.json({ result: typeof result.chargeMicros === "bigint" ? { ...result, chargeMicros: result.chargeMicros.toString() } : result }, { headers: sensitiveJsonHeaders });
  } catch {
    return NextResponse.json({ error: "Rekonsiliasi gagal diterapkan." }, { status: 409, headers: sensitiveJsonHeaders });
  }
}
