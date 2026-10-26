import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/security/secrets";
import { availableBalance } from "@/lib/seller-finance";
import { publishNotification } from "@/lib/realtime/publish";

const input = z.object({ amount: z.number().int().positive().finite(), method: z.enum(["BANK", "E_WALLET"]), accountName: z.string().trim().min(2).max(120), accountNumber: z.string().trim().min(4).max(80), bankName: z.string().trim().max(120).optional(), walletProvider: z.string().trim().max(80).optional(), sellerNote: z.string().trim().max(500).optional() });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user.id || session.user.role !== "SELLER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data withdraw tidak valid." }, { status: 400 });
  try {
    const transactionResult = await adminNotifiedTransaction(async (tx) => {
      const seller = await tx.sellerProfile.findUnique({ where: { userId: session.user.id } });
      if (!seller) throw new Error("Seller tidak ditemukan.");
      const settings = await tx.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {} });
      if (parsed.data.amount < settings.minimumWithdrawal) throw new Error(`Minimum withdraw Rp${settings.minimumWithdrawal.toLocaleString("id-ID")}.`);
      await tx.$queryRaw`SELECT "id" FROM "SellerProfile" WHERE "id" = ${seller.id} FOR UPDATE`;
      const available = await availableBalance(tx, seller.id);
      if (parsed.data.amount > available) throw new Error("Saldo tersedia tidak mencukupi.");
      const created = await tx.withdrawal.create({ data: { sellerId: seller.id, amount: parsed.data.amount, method: parsed.data.method, accountName: parsed.data.accountName, accountNumberEncrypted: encryptSecret(parsed.data.accountNumber), bankName: parsed.data.bankName || null, walletProvider: parsed.data.walletProvider || null, sellerNote: parsed.data.sellerNote || null } });
      await tx.sellerWalletTransaction.create({ data: { sellerId: seller.id, type: "WITHDRAW_RESERVED", amount: -created.amount, referenceType: "Withdrawal", referenceId: created.id, withdrawalId: created.id, description: "Withdrawal reserved" } });
      const notification = await tx.notification.create({ data: { userId: session.user.id, title: "Permintaan Withdraw Dikirim", message: "Permintaan withdraw kamu sedang ditinjau admin.", type: "WITHDRAWAL", link: "/seller/wallet" } });
      await tx.auditLog.create({ data: { actorId: session.user.id, action: "WITHDRAWAL_REQUESTED", entityType: "Withdrawal", entityId: created.id, metadata: { amount: created.amount, method: created.method } } });
      return { withdrawal: created, notification };
    }, (result) => ({
       eventKey: `seller-withdrawal:${result.withdrawal.id}`,
       title: "Penarikan Saldo Seller",
       message: "Ada permintaan withdraw seller yang perlu ditinjau.",
       link: `/admin/withdrawals/${result.withdrawal.id}`
     }), { isolationLevel: "Serializable" });
    await publishNotification(transactionResult.notification);
    return NextResponse.json({ ok: true, withdrawalId: transactionResult.withdrawal.id }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Withdraw gagal." }, { status: 400 }); }
}
