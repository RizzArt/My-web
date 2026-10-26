import { prisma } from "@/lib/prisma";
import { deliverOrder } from "@/lib/delivery/service";
import { fulfillStudioCreditTopUp } from "@/lib/studio/topups";

export async function fulfillPaidOrder(orderId: string) {
  const topUp = await prisma.studioCreditTopUp.findUnique({ where: { orderId }, select: { id: true } });
  if (topUp) return fulfillStudioCreditTopUp(orderId);
  return deliverOrder(orderId);
}
