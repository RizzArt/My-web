import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { AiApiAccountError, createCustomerAiApiKey } from "@/lib/ai-api/account";
import { hasTrustedSameOrigin, sensitiveJsonHeaders } from "@/lib/security/same-origin";

const input = z.object({ name: z.string().trim().min(1).max(100), expiresInDays: z.number().int().min(1).max(90).default(30) }).strict();
const idempotencyPattern = /^[A-Za-z0-9._:+/-]{8,200}$/;

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: sensitiveJsonHeaders });
  if (session.user.role !== "CUSTOMER") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403, headers: sensitiveJsonHeaders });
  const idempotency = request.headers.get("Idempotency-Key");
  if (!idempotency || !idempotencyPattern.test(idempotency)) return NextResponse.json({ error: "Idempotency-Key tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400, headers: sensitiveJsonHeaders });
  try {
    const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);
    const key = await createCustomerAiApiKey({ userId: session.user.id, name: parsed.data.name, issuanceEventKey: `customer-key:${session.user.id}:${idempotency}`, expiresAt });
    return NextResponse.json({ key, warning: "Simpan API key sekarang. Nilai ini tidak dapat ditampilkan kembali." }, { status: 201, headers: sensitiveJsonHeaders });
  } catch (error) {
    const status = error instanceof AiApiAccountError && error.code === "duplicate_issuance" ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "API key gagal dibuat." }, { status, headers: sensitiveJsonHeaders });
  }
}
