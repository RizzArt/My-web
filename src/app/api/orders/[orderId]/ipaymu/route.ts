import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { readIpaymuPaymentView } from "@/lib/payments/ipaymu-view";
import { createIpaymuInvoice } from "@/lib/payments/ipaymu-invoice";
import { verifyIpaymuOrder } from "@/lib/payments/ipaymu-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
type Context = { params: Promise<{ orderId: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const { orderId } = await context.params;
  try {
    return NextResponse.json(
      await readIpaymuPaymentView(orderId, session.user.id), { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Informasi VA belum tersedia." }, { status: 404, headers },
    );
  }
}

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const { orderId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(
      { error: "Permintaan tidak valid." }, { status: 400, headers },
    );
  }
  const parsed = z.object({
    action: z.enum(["create", "check"]),
  }).strict().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Permintaan tidak valid." }, { status: 400, headers },
    );
  }

  try {
    await readIpaymuPaymentView(orderId, session.user.id);
    if (parsed.data.action === "create") {
      await createIpaymuInvoice(orderId, session.user.id);
    } else {
      await verifyIpaymuOrder(orderId, session.user.id);
    }
    return NextResponse.json(
      await readIpaymuPaymentView(orderId, session.user.id), { headers },
    );
  } catch {
    return NextResponse.json({
      error: "VA belum dapat diproses. Periksa status sebelum mencoba lagi; jangan membuat pembayaran lain jika VA sedang dibuat.",
    }, { status: 409, headers });
  }
}
