import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveStudioReference } from "@/lib/studio/storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData().catch(() => null); const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Reference gambar wajib dipilih." }, { status: 400 });
  try { const storageKey = await saveStudioReference(file); await prisma.studioReference.create({ data: { userId: session.user.id, storageKey } }); return NextResponse.json({ storageKey }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Upload reference gagal." }, { status: 400 }); }
}
