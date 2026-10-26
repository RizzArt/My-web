import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertStudioRateLimit } from "@/lib/studio/rate-limit";
import { createStudioGeneration, processStudioGeneration } from "@/lib/studio/service";
import { assertStudioProviderRequest, isSupportedStudioProvider } from "@/lib/studio/providers/types";

export const runtime = "nodejs";
export const maxDuration = 180;
const input = z.object({ provider: z.string().refine(isSupportedStudioProvider), model: z.string().trim().min(1).max(160), prompt: z.string().trim().min(3).max(4_000), aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]), outputCount: z.number().int().min(1).max(4), referenceStorageKey: z.string().regex(/^reference-[0-9a-f-]{36}\.(jpg|png|webp)$/).optional() });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [models, generations, user] = await Promise.all([
    prisma.studioModelConfig.findMany({ where: { isEnabled: true }, select: { provider: true, model: true, displayName: true, creditCostPerImage: true, supportsReferenceImage: true, supportedAspectRatios: true }, orderBy: [{ provider: "asc" }, { displayName: "asc" }] }),
    prisma.studioGeneration.findMany({ where: { userId: session.user.id, deletedAt: null }, include: { outputs: { orderBy: { position: "asc" } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { studioCredits: true } }),
  ]);
  return NextResponse.json({ credits: user?.studioCredits ?? 0, models, generations });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Input generation tidak valid." }, { status: 400 });
  try {
    assertStudioProviderRequest(parsed.data.provider, { ...parsed.data, referenceImage: parsed.data.referenceStorageKey ? Buffer.alloc(1) : undefined });
    await assertStudioRateLimit(session.user.id);
    const generation = await createStudioGeneration({ userId: session.user.id, ...parsed.data });
    await processStudioGeneration(generation.id);
    const completed = await prisma.studioGeneration.findUniqueOrThrow({ where: { id: generation.id }, include: { outputs: { orderBy: { position: "asc" } } } });
    if (completed.status === "FAILED") {
      return NextResponse.json({ error: completed.errorMessage || "Generation gagal.", generation: completed }, { status: 502 });
    }
    return NextResponse.json({ generation: completed }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Generation gagal dibuat." }, { status: 400 }); }
}
