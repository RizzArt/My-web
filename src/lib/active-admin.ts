import { prisma } from "@/lib/prisma";

export async function requireActiveAdmin(userId: string) {
  const actor = await prisma.user.findFirst({
    where: { id: userId, isActive: true, role: "ADMIN" },
    select: { id: true },
  });
  return actor !== null;
}
