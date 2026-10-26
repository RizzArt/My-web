import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccountStatusError, changeAccountStatus } from "@/lib/account-status";

const input = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().max(500).default(""),
}).strict().refine(
  (value) => value.isActive || value.reason.length >= 3,
  { message: "Alasan ban minimal 3 karakter.", path: ["reason"] }
);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Silakan login." }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Data tidak valid." },
      { status: 400 }
    );
  }
  const { userId } = await params;
  try {
    const result = await prisma.$transaction(
      (tx) => changeAccountStatus(
        tx, session.user.id, userId, parsed.data.isActive, parsed.data.reason
      ),
      { isolationLevel: "Serializable" }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AccountStatusError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      return NextResponse.json(
        { error: "Status sedang berubah. Muat ulang dan coba lagi." },
        { status: 409 }
      );
    }
    console.error("Account status update failed");
    return NextResponse.json({ error: "Status akun gagal disimpan." }, { status: 500 });
  }
}
