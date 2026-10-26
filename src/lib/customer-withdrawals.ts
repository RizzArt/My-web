import { adminNotifiedTransaction } from "@/lib/admin-notifications";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/security/secrets";

const DEFAULT_MINIMUM = 10000;
function retryable(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"; }

export async function createCustomerWithdrawal(input: { userId: string; amount: number; payoutType: "BANK" | "EWALLET"; payoutProvider: string; accountNumber: string; accountName: string }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adminNotifiedTransaction(async (tx) => {
        const settings = await tx.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {} });
        const minimum = settings.minimumWithdrawal || DEFAULT_MINIMUM;
        if (input.amount < minimum) throw new Error(`Minimum penarikan Rp${minimum.toLocaleString("id-ID")}.`);
        const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { balance: true } });
        if (user.balance < input.amount) throw new Error("Saldo tersedia tidak mencukupi.");
        const pending = await tx.customerWithdrawal.findFirst({ where: { userId: input.userId, status: "PENDING" }, select: { id: true } });
        if (pending) throw new Error("Masih ada penarikan yang menunggu review.");
        const balanceAfter = user.balance - input.amount;
        await tx.user.update({ where: { id: input.userId }, data: { balance: balanceAfter } });
        const withdrawal = await tx.customerWithdrawal.create({ data: { userId: input.userId, amount: input.amount, payoutType: input.payoutType, payoutProvider: input.payoutProvider, payoutAccountNumberEncrypted: encryptSecret(input.accountNumber), payoutAccountName: input.accountName } });
        await tx.walletTransaction.create({ data: { userId: input.userId, type: "WITHDRAWAL_HOLD", amount: -input.amount, balanceBefore: user.balance, balanceAfter, referenceType: "CustomerWithdrawal", referenceId: withdrawal.id, description: `Penahanan penarikan ${input.payoutProvider}` } });
        await tx.auditLog.create({ data: { actorId: input.userId, action: "CUSTOMER_WITHDRAWAL_REQUESTED", entityType: "CustomerWithdrawal", entityId: withdrawal.id, metadata: { amount: input.amount, payoutType: input.payoutType, payoutProvider: input.payoutProvider } } });
        return withdrawal;
      }, (result) => ({
      eventKey: `buyer-withdrawal:${result.id}`,
      title: "Penarikan Saldo Buyer",
      message: "Ada permintaan penarikan saldo buyer yang perlu ditinjau.",
      link: "/admin/customer-withdrawals"
    }), { isolationLevel: "Serializable" });
    } catch (error) { if (retryable(error) && attempt < 2) continue; throw error; }
  }
  throw new Error("Penarikan tidak dapat dibuat.");
}

export async function reviewCustomerWithdrawal(id: string, adminId: string, action: "APPROVE" | "REJECT" | "PAID", note?: string, transferReference?: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) try {
    return await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.customerWithdrawal.findUnique({ where: { id } });
    if (!withdrawal) throw new Error("Penarikan tidak ditemukan.");
    if (action === "APPROVE") {
      if (withdrawal.status !== "PENDING") throw new Error("State transition tidak valid.");
      const claimed = await tx.customerWithdrawal.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: adminId, adminNote: note || null } });
      if (claimed.count !== 1) throw new Error("State transition tidak valid.");
      return tx.customerWithdrawal.findUniqueOrThrow({ where: { id } });
    }
    if (action === "REJECT") {
      if (withdrawal.status !== "PENDING" || !note?.trim()) throw new Error("Penarikan hanya dapat ditolak dari PENDING dan catatan wajib diisi.");
      const user = await tx.user.findUniqueOrThrow({ where: { id: withdrawal.userId }, select: { balance: true } });
      const balanceAfter = user.balance + withdrawal.amount;
      await tx.user.update({ where: { id: withdrawal.userId }, data: { balance: balanceAfter } });
      await tx.walletTransaction.create({ data: { userId: withdrawal.userId, type: "WITHDRAWAL_RELEASE", amount: withdrawal.amount, balanceBefore: user.balance, balanceAfter, referenceType: "CustomerWithdrawal", referenceId: withdrawal.id, description: "Pengembalian saldo penarikan yang ditolak" } });
      const claimed = await tx.customerWithdrawal.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: adminId, adminNote: note } });
      if (claimed.count !== 1) throw new Error("State transition tidak valid.");
      return tx.customerWithdrawal.findUniqueOrThrow({ where: { id } });
    }
    if (withdrawal.status !== "APPROVED") throw new Error("Hanya penarikan APPROVED yang dapat ditandai dibayar.");
    const claimed = await tx.customerWithdrawal.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PAID", paidAt: new Date(), transferReference: transferReference || null, reviewedById: adminId, adminNote: note || withdrawal.adminNote } });
    if (claimed.count !== 1) throw new Error("State transition tidak valid.");
    return tx.customerWithdrawal.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (retryable(error) && attempt < 2) continue;
    throw error;
  }
  throw new Error("Penarikan tidak dapat diproses.");
}
