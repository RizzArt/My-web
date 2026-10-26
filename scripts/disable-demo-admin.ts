import { PrismaClient, Role } from "@prisma/client";
import { assertNotLastActiveAdmin } from "../src/lib/admin-security";

const prisma = new PrismaClient();
const demoEmail = "admin@digitalstore.test";

async function main() {
  await prisma.$transaction(async (tx) => {
    const demo = await tx.user.findUnique({ where: { email: demoEmail }, select: { id: true, role: true, isActive: true } });
    if (!demo) throw new Error("Akun demo tidak ditemukan.");
    if (demo.role !== Role.ADMIN) throw new Error("Akun demo bukan ADMIN; tidak ada perubahan yang dibuat.");
    if (!demo.isActive) { console.log("Akun demo sudah nonaktif."); return; }
    await assertNotLastActiveAdmin(tx, demo.id);
    await tx.user.update({ where: { id: demo.id }, data: { isActive: false } });
    await tx.auditLog.create({ data: { action: "ADMIN_DISABLED", entityType: "User", entityId: demo.id, metadata: { email: demoEmail, reason: "demo account retired" } } });
  });
  console.log("Akun demo admin dinonaktifkan.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Gagal menonaktifkan akun demo."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
