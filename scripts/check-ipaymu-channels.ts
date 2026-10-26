import {
  ipaymuConfig,
  ipaymuRequest,
} from "../src/lib/payments/ipaymu-client";

async function run() {
  const data = await ipaymuRequest("GET", "/api/v2/payment-channels");
  if (!Array.isArray(data)) throw new Error("Format daftar metode tidak sesuai.");

  const method = data.find((item) =>
    item && typeof item === "object" &&
    String(item.Code).toLowerCase() === "va"
  );
  if (!method || !Array.isArray(method.Channels)) {
    throw new Error("Daftar bank VA belum tersedia pada akun ini.");
  }

  console.log("Mode:", ipaymuConfig().mode);
  console.log("Bank VA dan biaya dari iPaymu:");
  for (const raw of method.Channels) {
    if (!raw || typeof raw !== "object") continue;
    const fee = raw.TransactionFee;
    console.log(JSON.stringify({
      bank: raw.Code,
      nama: raw.Name,
      status: raw.FeatureStatus,
      jaringan: raw.HealthStatus,
      biaya: fee?.ActualFee,
      jenisBiaya: fee?.ActualFeeType,
      biayaTambahan: fee?.AdditionalFee,
    }));
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Pemeriksaan gagal.");
  process.exitCode = 1;
});
