import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function readHidden(prompt: string) {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    let value = "";
    process.stdout.write(prompt);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      if (chunk === "\r" || chunk === "\n") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (chunk === "\u0003") {
        process.exit(130);
      } else if (chunk === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += chunk;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const adminPassword = await readHidden("Password dummy admin Sandbox (hidden): ");
  const buyerPassword = await readHidden("Password dummy buyer Sandbox (hidden): ");
  if (adminPassword.length < 16 || buyerPassword.length < 16) throw new Error("Setiap password dummy minimal 16 karakter.");

  const [adminHash, buyerHash] = await Promise.all([bcrypt.hash(adminPassword, 12), bcrypt.hash(buyerPassword, 12)]);
  const category = await prisma.category.upsert({
    where: { slug: "paypal-sandbox" },
    update: { name: "PayPal Sandbox", description: "Produk dummy untuk verifikasi PayPal Sandbox." },
    create: { name: "PayPal Sandbox", slug: "paypal-sandbox", description: "Produk dummy untuk verifikasi PayPal Sandbox." },
  });
  const product = await prisma.product.upsert({
    where: { slug: "paypal-sandbox-dummy-product" },
    update: { name: "PayPal Sandbox Dummy Product", description: "Produk dummy. Tidak untuk pelanggan atau transaksi produksi.", shortDescription: "Dummy sandbox", price: 16000, categoryId: category.id, isPublished: true, isFeatured: false },
    create: { name: "PayPal Sandbox Dummy Product", slug: "paypal-sandbox-dummy-product", description: "Produk dummy. Tidak untuk pelanggan atau transaksi produksi.", shortDescription: "Dummy sandbox", price: 16000, categoryId: category.id, isPublished: true, isFeatured: false },
  });
  await prisma.digitalInventory.createMany({
    data: ["paypal-sandbox-license-001", "paypal-sandbox-license-002"].map((secretValue) => ({ productId: product.id, secretValue })),
    skipDuplicates: true,
  });
  await prisma.user.upsert({
    where: { email: "sandbox-admin@riezz99.test" },
    update: { name: "Sandbox Admin", passwordHash: adminHash, role: Role.ADMIN, isActive: true },
    create: { name: "Sandbox Admin", email: "sandbox-admin@riezz99.test", passwordHash: adminHash, role: Role.ADMIN },
  });
  await prisma.user.upsert({
    where: { email: "sandbox-buyer@riezz99.test" },
    update: { name: "Sandbox Buyer", passwordHash: buyerHash, role: Role.CUSTOMER, isActive: true },
    create: { name: "Sandbox Buyer", email: "sandbox-buyer@riezz99.test", passwordHash: buyerHash, role: Role.CUSTOMER },
  });
  console.info("PayPal Sandbox dummy data ready: sandbox-admin@riezz99.test, sandbox-buyer@riezz99.test, paypal-sandbox-dummy-product");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Gagal membuat data dummy PayPal Sandbox.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
