import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret, maskPayoutDestination } from "@/lib/security/secrets";
export async function GET() {
  const session = await auth(); if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await prisma.customerWithdrawal.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows.map((row) => ({ ...row, payoutAccountNumberEncrypted: undefined, destinationMasked: maskPayoutDestination(decryptSecret(row.payoutAccountNumberEncrypted)) })));
}
