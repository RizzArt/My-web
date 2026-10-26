import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { customerAiApiOverview, customerAiApiOverviewResponse } from "@/lib/ai-api/account";
import { sensitiveJsonHeaders } from "@/lib/security/same-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: sensitiveJsonHeaders });
  if (session.user.role !== "CUSTOMER") return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: sensitiveJsonHeaders });
  const data = await customerAiApiOverview(session.user.id);
  return NextResponse.json(customerAiApiOverviewResponse(data), { headers: sensitiveJsonHeaders });
}
