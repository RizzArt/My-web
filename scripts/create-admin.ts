import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PrismaClient, Role } from "@prisma/client";
import { hashAdminPassword } from "../src/lib/admin-security";

const prisma = new PrismaClient();

async function readHidden(prompt: string) {
  if (!input.isTTY || !output.isTTY) throw new Error(`${prompt} wajib diisi melalui ADMIN_PASSWORD saat stdin bukan terminal.`);
  output.write(prompt);
  const terminal = input as typeof input & { setRawMode?: (value: boolean) => void };
  terminal.setRawMode?.(true);
  let value = "";
  for await (const chunk of input) {
    const text = String(chunk);
    for (const char of text) {
      if (char === "\u0003") process.exit(130);
      if (char === "\r" || char === "\n") { terminal.setRawMode?.(false); output.write("\n"); return value; }
      if (char === "\u007f") value = value.slice(0, -1);
      else value += char;
    }
  }
  terminal.setRawMode?.(false);
  return value;
}

async function main() {
  const rl = process.env.ADMIN_EMAIL && process.env.ADMIN_NAME ? null : createInterface({ input, output });
  const email = (process.env.ADMIN_EMAIL ?? await rl!.question("Admin email: ")).trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? await rl!.question("Admin name: ")).trim();
  const password = process.env.ADMIN_PASSWORD ?? await readHidden("Admin password (hidden): ");
  rl?.close();
  if (!email || !name || !password) throw new Error("Email, name, dan password wajib diisi.");
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new Error("Email sudah digunakan; tidak ada perubahan yang dibuat.");
  const passwordHash = await hashAdminPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { email, name, passwordHash, role: Role.ADMIN, isActive: true, emailVerified: new Date() } });
    await tx.auditLog.create({ data: { action: "ADMIN_CREATED", entityType: "User", entityId: created.id, metadata: { email: created.email } } });
    return created;
  });
  console.log(`Admin production dibuat: ${user.email}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Gagal membuat admin."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
