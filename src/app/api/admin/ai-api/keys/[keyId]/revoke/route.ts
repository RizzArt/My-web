import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { revokeAiApiKey } from "@/lib/ai-api/admin";
import { verifyFreshAdminMfa } from "@/lib/admin-mfa-service";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";

const input = z.object({ reason: z.string().trim().min(3).max(300), mfaCode: z.string().trim().min(6).max(128) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  if (!await verifyFreshAdminMfa(session.user.id, parsed.data.mfaCode)) return NextResponse.json({ error: "MFA admin diperlukan untuk mencabut API key." }, { status: 403, headers: sensitiveJsonHeaders });
  try {
    const { keyId } = await params;
    return NextResponse.json(await revokeAiApiKey({ actorId: session.user.id, keyId, reason: parsed.data.reason }), { headers: sensitiveJsonHeaders });
  } catch {
    return NextResponse.json({ error: "API key gagal dicabut." }, { status: 400, headers: sensitiveJsonHeaders });
  }
}
