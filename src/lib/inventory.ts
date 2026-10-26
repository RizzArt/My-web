import type { InventoryStatus, ProductType } from "@prisma/client";
import { hashSecret } from "@/lib/security/secrets";

export const inventoryBackedTypes: ProductType[] = ["LICENSE_KEY", "VOUCHER", "ACCOUNT", "ACCESS_LINK"];
export const MAX_BULK_INVENTORY = 500;

export function normalizeInventoryValue(value: string) {
  return value.trim();
}

export function parseInventoryValues(raw: string, type: ProductType) {
  const seen = new Set<string>();
  const values: string[] = [];
  let invalid = 0;
  let duplicate = 0;
  for (const line of raw.split(/\r?\n/)) {
    const value = normalizeInventoryValue(line);
    if (!value) continue;
    const valid = type === "ACCESS_LINK" ? /^https?:\/\/\S+$/i.test(value) : type === "ACCOUNT" ? value.includes("|") && value.split("|").every((part) => part.trim().length > 0) : value.length <= 10000;
    const key = value.toLowerCase();
    if (!valid) { invalid += 1; continue; }
    if (seen.has(key)) { duplicate += 1; continue; }
    seen.add(key);
    values.push(value);
  }
  return { values: values.slice(0, MAX_BULK_INVENTORY), invalid: invalid + Math.max(0, values.length - MAX_BULK_INVENTORY), duplicate, detected: Math.min(values.length, MAX_BULK_INVENTORY) };
}

export function inventoryValueHash(value: string) {
  return hashSecret(normalizeInventoryValue(value).toLowerCase());
}

export function maskInventoryValue(value: string) {
  const normalized = value.trim();
  if (normalized.includes("|")) return `${normalized.split("|")[0].slice(0, 3)}***|••••••`;
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}***`;
  return `${normalized.slice(0, Math.min(4, Math.floor(normalized.length / 3)))}${"*".repeat(Math.min(8, normalized.length - 7))}${normalized.slice(-4)}`;
}

export function inventoryCounts(items: Array<{ status: InventoryStatus }>) {
  return {
    available: items.filter((item) => item.status === "AVAILABLE").length,
    reserved: items.filter((item) => item.status === "ASSIGNED").length,
    sold: items.filter((item) => item.status === "DELIVERED" || item.status === "SOLD").length,
    total: items.length,
  };
}
