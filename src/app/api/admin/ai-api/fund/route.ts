import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { fundAiApiWallet } from "@/lib/ai-api/admin";
import { verifyFreshAdminMfa } from "@/lib/admin-mfa-service";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";

const input = z.object({ userId: z.string().min(1), amountRupiah: z.string().regex(/^\d{1,10}$/), reason: z.string().trim().min(3).max(300), mfaCode: z.string().trim().min(6).max(128) }).strict();

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const idempotency = request.headers.get("idempotency-key");
  if (!idempotency || !/^[A-Za-z0-9._:+/-]{8,200}$/.test(idempotency)) return NextResponse.json({ error: "Idempotency-Key tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  if (!await verifyFreshAdminMfa(session.user.id, parsed.data.mfaCode)) return NextResponse.json({ error: "MFA admin diperlukan untuk pendanaan API Balance." }, { status: 403, headers: sensitiveJsonHeaders });
  try {
    const result = await fundAiApiWallet({ actorId: session.user.id, userId: parsed.data.userId, amountMicros: BigInt(parsed.data.amountRupiah) * BigInt(1_000_000), eventKey: `admin-fund:${session.user.id}:${idempotency}`, reason: parsed.data.reason });
    return NextResponse.json({ ...result, availableMicros: result.availableMicros.toString() }, { headers: sensitiveJsonHeaders });
  } catch {
    return NextResponse.json({ error: "Pendanaan API Balance gagal." }, { status: 400, headers: sensitiveJsonHeaders });
  }
}
