import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findAdminRefunds, parseAdminRefundStatus } from "@/lib/admin-refunds";
import { publicRefund } from "@/lib/refunds";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = parseAdminRefundStatus(new URL(request.url).searchParams.get("status"));
  const rows = await findAdminRefunds(status);
  return NextResponse.json(rows.map((row) => ({ ...publicRefund(row), order: row.order, user: row.user })));
}
