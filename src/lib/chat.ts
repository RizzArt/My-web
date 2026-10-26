import type { Prisma, PrismaClient } from "@prisma/client";

type DatabaseClient = Pick<PrismaClient, "user"> | Pick<Prisma.TransactionClient, "user">;

/** Select one active admin consistently for support conversations. */
export function getSupportAdmin(db: DatabaseClient) {
  return db.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { id: "asc" }, select: { id: true } });
}

export function canAccessConversation(conversation: { customerId: string; sellerId: string | null; seller?: { userId: string } | null; adminSupport: boolean }, user: { id: string; role: string }) {
  if (user.role === "ADMIN") return conversation.adminSupport;
  if (user.role === "SELLER") return conversation.seller?.userId === user.id;
  if (user.role !== "CUSTOMER" || conversation.customerId !== user.id) return false;
  // Support customers have no seller; buyer-seller threads must have one.
  return conversation.adminSupport ? !conversation.seller : Boolean(conversation.seller);
}

export function conversationDeleteField(role: string) {
  if (role === "ADMIN") return "adminDeletedAt" as const;
  if (role === "SELLER") return "sellerDeletedAt" as const;
  return "customerDeletedAt" as const;
}

export function conversationIsDeleted(conversation: Record<string, unknown>, role: string) {
  return Boolean(conversation[conversationDeleteField(role)]);
}

export function cleanMessage(value: unknown) {
  if (typeof value !== "string") throw new Error("Pesan tidak valid.");
  const content = value.trim();
  if (!content) throw new Error("Pesan tidak boleh kosong.");
  if (content.length > 2000) throw new Error("Pesan maksimal 2000 karakter.");
  return content;
}

export function cleanOptionalMessage(value: unknown) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "";
  return cleanMessage(value);
}
