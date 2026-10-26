import { reconcileRefundSellerEarnings } from "@/lib/refunds";

async function main() {
  const refundId = process.argv[2];
  if (!refundId || process.argv[3] !== "--apply") throw new Error("Usage: tsx scripts/reconcile-refund-seller-earnings.ts <refundId> --apply");
  console.log(JSON.stringify(await reconcileRefundSellerEarnings(refundId)));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
