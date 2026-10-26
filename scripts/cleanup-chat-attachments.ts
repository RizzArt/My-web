import { readdir, stat } from "node:fs/promises";
import { deleteChatMedia } from "../src/lib/storage/chat-media";
import { chatMediaStorageRoot } from "../src/lib/storage/chat-media";
import { prisma } from "../src/lib/prisma";

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const referencedRows = await prisma.chatAttachment.findMany({ select: { storageKey: true } });
const referenced = new Set(referencedRows.map((row) => row.storageKey));
const stale = await prisma.chatAttachment.findMany({ where: { messageId: null, createdAt: { lt: cutoff } }, select: { id: true, storageKey: true } });
for (const attachment of stale) {
  await prisma.chatAttachment.deleteMany({ where: { id: attachment.id, messageId: null } });
  referenced.delete(attachment.storageKey);
  await deleteChatMedia(attachment.storageKey);
}
let orphanFiles = 0;
for (const entry of await readdir(chatMediaStorageRoot(), { withFileTypes: true }).catch(() => [])) {
  if (!entry.isFile() || !/^[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov)$/.test(entry.name) || referenced.has(entry.name)) continue;
  const filePath = `${chatMediaStorageRoot()}/${entry.name}`;
  if ((await stat(filePath)).mtime < cutoff) { await deleteChatMedia(entry.name); orphanFiles += 1; }
}
console.log(`Cleaned ${stale.length} stale pending attachment(s) and ${orphanFiles} unreferenced file(s).`);
await prisma.$disconnect();
