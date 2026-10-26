import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { setAiApiModelAvailability } from "@/lib/ai-api/admin";
import { AI_API_CATALOG } from "@/lib/ai-api/catalog";
import { aiApiHealthMonitorConfig } from "@/lib/ai-api/provider-health";
import { verifyFreshAdminMfa } from "@/lib/admin-mfa-service";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";
import { requireActiveAdmin } from "@/lib/active-admin";

const input = z.object({ publicId: z.string().min(1), enabled: z.boolean(), expectedPriceVersion: z.number().int().min(1), verificationReference: z.string().regex(/^[A-Za-z0-9._:+/-]{6,200}$/), reason: z.string().trim().min(3).max(300), mfaCode: z.string().trim().min(6).max(128) }).strict();

export async function GET() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!await requireActiveAdmin(session.user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  const models = await prisma.aiApiModel.findMany({ where: { provider: "GRIPHUB", publicId: { in: AI_API_CATALOG.map((model) => model.id) } }, include: { providerHealth: true, prices: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { publicId: "asc" } });
  return NextResponse.json({ monitor: aiApiHealthMonitorConfig(), models: models.filter((model) => AI_API_CATALOG.some((entry) => entry.id === model.publicId && entry.provider === model.provider)).map((model) => ({ id: model.publicId, displayName: AI_API_CATALOG.find((entry) => entry.id === model.publicId)!.displayName, activationAllowed: false, enabled: model.enabled, maxOutputTokens: model.privateBetaMaxOutputTokens, health: model.providerHealth ? { breakerState: model.providerHealth.breakerState, healthyUntil: model.providerHealth.healthyUntil, consecutiveFailures: model.providerHealth.consecutiveFailures, lastSuccessAt: model.providerHealth.lastSuccessAt, safeReasonCode: model.providerHealth.safeReasonCode } : null, price: model.prices[0] ? { version: model.prices[0].version, upstreamInputMicrosPerMillion: model.prices[0].upstreamInputMicrosPerMillion.toString(), upstreamOutputMicrosPerMillion: model.prices[0].upstreamOutputMicrosPerMillion.toString(), retailInputMicrosPerMillion: model.prices[0].retailInputMicrosPerMillion.toString(), retailOutputMicrosPerMillion: model.prices[0].retailOutputMicrosPerMillion.toString(), verifiedAt: model.prices[0].verifiedAt } : null })) }, { headers: sensitiveJsonHeaders });
}

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  if (!await verifyFreshAdminMfa(session.user.id, parsed.data.mfaCode)) return NextResponse.json({ error: "MFA admin diperlukan untuk mengubah status model." }, { status: 403, headers: sensitiveJsonHeaders });
  try {
    const model = await setAiApiModelAvailability({ actorId: session.user.id, ...parsed.data });
    return NextResponse.json({ model }, { headers: sensitiveJsonHeaders });
  } catch {
    return NextResponse.json({ error: "Status model gagal diubah." }, { status: 409, headers: sensitiveJsonHeaders });
  }
}
