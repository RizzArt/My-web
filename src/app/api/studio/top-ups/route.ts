import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createStudioCreditTopUp } from "@/lib/studio/topups";

const input = z.object({ packageCode: z.literal("STUDIO_100") }).strict();

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paket top up tidak valid." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true } });
  if (!user?.isActive) return NextResponse.json({ error: "Akun tidak aktif." }, { status: 403 });
  try { return NextResponse.json(await createStudioCreditTopUp(session.user.id, parsed.data.packageCode), { status: 201 }); }
  catch (error) {
    console.error("Studio top-up creation failed", { packageCode: parsed.data.packageCode, category: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Top up belum dapat dibuat. Silakan coba lagi nanti." }, { status: 400 });
  }
}
