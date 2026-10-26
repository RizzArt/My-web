import { ipaymuRequest } from "./ipaymu-client";

export type VaBank = { code: string; name: string; fee: number };

export function parseVaBanks(data: unknown): VaBank[] {
  if (!Array.isArray(data)) throw new Error("Daftar bank iPaymu tidak sesuai.");
  const method = data.find((item) =>
    item && typeof item === "object" && item.Code === "va"
  );
  if (!method || !Array.isArray(method.Channels)) {
    throw new Error("Metode VA belum tersedia.");
  }

  const banks: VaBank[] = [];
  for (const item of method.Channels) {
    if (!item || typeof item !== "object") continue;
    if (item.FeatureStatus !== "active" || item.HealthStatus !== "online") continue;
    const fee = item.TransactionFee;
    if (!fee || fee.ActualFeeType !== "FLAT") continue;
    const base = Number(fee.ActualFee);
    const extra = Number(fee.AdditionalFee ?? 0);
    if (!Number.isSafeInteger(base) || !Number.isSafeInteger(extra)) continue;
    if (base < 0 || extra < 0 || !Number.isSafeInteger(base + extra)) continue;
    if (typeof item.Code !== "string" || !/^[a-z0-9_]+$/.test(item.Code)) continue;
    if (typeof item.Name !== "string" || !item.Name.trim()) continue;
    banks.push({ code: item.Code, name: item.Name, fee: base + extra });
  }
  return banks;
}

export async function availableVaBanks() {
  if (process.env.IPAYMU_ENABLED !== "true") return [];
  return parseVaBanks(await ipaymuRequest("GET", "/api/v2/payment-channels"));
}

export async function selectVaBank(code: string | undefined) {
  if (process.env.IPAYMU_ENABLED !== "true") {
    throw new Error("Virtual Account belum diaktifkan.");
  }
  const bank = (await availableVaBanks()).find((item) => item.code === code);
  if (!bank) throw new Error("Bank VA tidak tersedia. Pilih ulang metode pembayaran.");
  return bank;
}
