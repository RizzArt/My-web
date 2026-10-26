import { NextResponse } from "next/server";
import { ipaymuConfig } from "@/lib/payments/ipaymu-client";
import {
  parseIpaymuCallbackBody,
  verifyIpaymuCallbackSignature,
} from "@/lib/payments/ipaymu-callback-signature";
import { processIpaymuCallback } from "@/lib/payments/ipaymu-callback";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  let merchantVa: string;
  try {
    merchantVa = ipaymuConfig().va;
  } catch {
    return NextResponse.json(
      { error: "Callback belum tersedia." }, { status: 503, headers },
    );
  }

  let payload: Record<string, unknown>;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declaredLength) || declaredLength > 65536) {
      return NextResponse.json(
        { error: "Payload terlalu besar." }, { status: 413, headers },
      );
    }
    payload = parseIpaymuCallbackBody(
      await request.text(), request.headers.get("content-type") ?? "",
    );
  } catch {
    return NextResponse.json(
      { error: "Payload tidak valid." }, { status: 400, headers },
    );
  }

  if (!verifyIpaymuCallbackSignature(
    payload, request.headers.get("x-signature"), merchantVa,
  )) {
    return NextResponse.json(
      { error: "Signature tidak valid." }, { status: 401, headers },
    );
  }

  try {
    await processIpaymuCallback(payload);
    return NextResponse.json({ status: "OK" }, { headers });
  } catch {
    // Jangan kirim sukses sebelum verifikasi dan penyimpanan selesai.
    return NextResponse.json(
      { error: "Callback belum selesai diproses." }, { status: 503, headers },
    );
  }
}
