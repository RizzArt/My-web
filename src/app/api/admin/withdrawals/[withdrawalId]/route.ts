import { POST as processWithdrawal } from "@/app/api/admin/withdrawals/route";

export async function POST(request: Request, { params }: { params: Promise<{ withdrawalId: string }> }) {
  void params;
  return processWithdrawal(request);
}
