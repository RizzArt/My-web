import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() { const session = await auth(); if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { balance: true, walletTransactions: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, amount: true, balanceAfter: true, description: true, createdAt: true } } } }); return NextResponse.json(user); }
