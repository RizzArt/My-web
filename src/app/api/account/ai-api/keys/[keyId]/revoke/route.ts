import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { AiApiAccountError, revokeCustomerAiApiKey } from "@/lib/ai-api/account";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";

const input = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: sensitiveJsonHeaders });
  if (session.user.role !== "CUSTOMER") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  const { keyId } = await params;
  try {
    return NextResponse.json({ result: await revokeCustomerAiApiKey({ userId: session.user.id, keyId, reason: parsed.data.reason }) }, { headers: sensitiveJsonHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AiApiAccountError && error.code === "key_not_found" ? "API key tidak ditemukan." : "API key gagal dicabut." }, { status: error instanceof AiApiAccountError && error.code === "key_not_found" ? 404 : 400, headers: sensitiveJsonHeaders });
  }
}
