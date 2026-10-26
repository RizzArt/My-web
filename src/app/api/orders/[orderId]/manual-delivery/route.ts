import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { manuallyDeliver } from "@/lib/delivery/service";

const input = z.object({ deliveryId: z.string().min(1), message: z.string().trim().min(1).max(2000), content: z.string().trim().max(10000).optional().or(z.literal("")), accessLink: z.string().trim().url().max(2000).optional().or(z.literal("")), credential: z.string().trim().max(5000).optional().or(z.literal("")) });

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "SELLER"].includes(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pesan delivery wajib diisi dan format link harus valid." }, { status: 400 });
  const { orderId } = await params;
  try {
    await manuallyDeliver(orderId, parsed.data.deliveryId, session.user.id, session.user.role as "ADMIN" | "SELLER", parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery manual gagal diproses.";
    if (message === "Seller tidak memiliki produk ini.") return NextResponse.json({ error: message }, { status: 403 });
    return NextResponse.json({ error: message.includes("tidak tersedia") ? message : "Delivery manual gagal diproses." }, { status: 400 });
  }
}
