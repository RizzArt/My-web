import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  generateSociaBuzzQr,
  verifySociaBuzzOrder,
} from "@/lib/payments/sociabuzz-service";

export const runtime = "nodejs";

const input = z.object({
  action: z.enum(["create", "check"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  try {
    const { orderId } = await params;
    if (parsed.data.action === "check") {
      return NextResponse.json(
        await verifySociaBuzzOrder(orderId, session.user.id),
      );
    }
    const qr = await generateSociaBuzzQr(orderId, session.user.id);
    return NextResponse.json({
      status: qr.status,
      invoiceId: qr.invoiceId,
      qrImage: await QRCode.toDataURL(qr.qrCode, {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 360,
      }),
      amount: qr.amount,
      totalPay: qr.totalPay,
      createdAt: qr.createdAt,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Pembayaran belum dapat diproses.",
    }, { status: 400 });
  }
}
