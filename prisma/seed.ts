import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);
  const category = await prisma.category.upsert({ where: { slug: "template" }, update: {}, create: { name: "Template", slug: "template", description: "Template siap pakai untuk mempercepat kerja." } });
  const categories = await prisma.category.createMany({ data: [{ name: "Ebook", slug: "ebook", description: "Insight praktis untuk skill digital." }, { name: "Asset", slug: "asset", description: "Asset visual untuk project kamu." }], skipDuplicates: true });
  void categories;
  const products = [
    { name: "Creator Launch Kit", slug: "creator-launch-kit", price: 149000, description: "Paket lengkap template dan panduan untuk meluncurkan produk digital pertamamu.", shortDescription: "Template launch page, content plan, dan checklist.", categoryId: category.id, isFeatured: true },
    { name: "Minimal Portfolio UI", slug: "minimal-portfolio-ui", price: 99000, description: "Komponen portfolio modern dengan layout bersih dan dokumentasi yang mudah diikuti.", shortDescription: "UI kit Figma untuk portfolio yang standout.", categoryId: category.id, isFeatured: true },
    { name: "Notion Focus System", slug: "notion-focus-system", price: 79000, description: "Sistem workspace Notion untuk merapikan ide, proyek, dan rutinitas mingguan.", shortDescription: "Workspace Notion untuk kerja yang lebih fokus.", categoryId: category.id, isFeatured: false },
  ];
  for (const product of products) {
    const saved = await prisma.product.upsert({ where: { slug: product.slug }, update: product, create: product });
    await prisma.digitalInventory.createMany({ data: [`${product.slug}-license-001`, `${product.slug}-license-002`].map((secretValue) => ({ productId: saved.id, secretValue })), skipDuplicates: true });
  }
  await prisma.user.upsert({ where: { email: "admin@digitalstore.test" }, update: {}, create: { name: "Store Admin", email: "admin@digitalstore.test", passwordHash, role: Role.ADMIN } });
  await prisma.user.upsert({ where: { email: "customer@digitalstore.test" }, update: {}, create: { name: "Demo Customer", email: "customer@digitalstore.test", passwordHash, role: Role.CUSTOMER } });
  console.log("Seed complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
