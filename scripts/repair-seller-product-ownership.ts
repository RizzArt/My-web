import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const orphanProducts = await prisma.product.findMany({
    where: { moderationStatus: "PENDING_REVIEW", sellerId: null },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  });

  let repaired = 0;
  let skipped = 0;

  for (const product of orphanProducts) {
    const creationLogs = await prisma.auditLog.findMany({
      where: { entityType: "Product", entityId: product.id, action: "SELLER_PRODUCT_CREATED" },
      select: { actorId: true },
    });
    const actorIds = [...new Set(creationLogs.map((log) => log.actorId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds }, role: "SELLER" }, select: { id: true, sellerProfile: { select: { id: true } } } }) : [];
    const sellerIds = [...new Set(actors.map((actor) => actor.sellerProfile?.id).filter((id): id is string => Boolean(id)))];

    if (sellerIds.length !== 1 || actors.length !== actorIds.length) {
      skipped += 1;
      console.log(`SKIP ${product.id} ${product.name} (ownership tidak dapat dibuktikan secara tunggal)`);
      continue;
    }

    if (!apply) {
      repaired += 1;
      console.log(`WOULD_REPAIR ${product.id} ${product.name} -> ${sellerIds[0]}`);
      continue;
    }

    const result = await prisma.product.updateMany({ where: { id: product.id, moderationStatus: "PENDING_REVIEW", sellerId: null }, data: { sellerId: sellerIds[0] } });
    if (result.count === 1) {
      repaired += 1;
      console.log(`REPAIRED ${product.id} ${product.name} -> ${sellerIds[0]}`);
    } else {
      skipped += 1;
      console.log(`SKIP ${product.id} ${product.name} (record berubah sebelum repair)`);
    }
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned: orphanProducts.length, repaired, skipped }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Repair gagal."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
