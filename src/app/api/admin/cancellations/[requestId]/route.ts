import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { reviewCancellation } from "@/lib/customer-cancellation";

const input = z.object({ action: z.enum(["APPROVE", "REJECT"]), adminNote: z.string().trim().max(1000).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.action === "REJECT" && !parsed.data.adminNote)) return NextResponse.json({ error: "Catatan penolakan wajib diisi." }, { status: 400 });
  try {
    const result = await reviewCancellation((await params).requestId, session.user.id, parsed.data.action === "APPROVE", parsed.data.adminNote);
    return NextResponse.json({ ok: true, request: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action gagal." }, { status: 400 });
  }
}
