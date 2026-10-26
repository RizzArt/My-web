import { NextResponse } from "next/server";
import { availableVaBanks } from "@/lib/payments/ipaymu-options";
import { paypalPublicConfig } from "@/lib/payments/paypal";
import { canUsePayPalForProductIds } from "@/lib/payments/paypal-eligibility";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const productIds = new URL(request.url).searchParams.getAll("productId");
  const paypal = await canUsePayPalForProductIds(productIds) ? paypalPublicConfig() : { enabled: false };
  try {
    return NextResponse.json(
      { vaBanks: await availableVaBanks(), paypal },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { vaBanks: [], paypal, note: "Virtual Account sementara tidak tersedia." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
