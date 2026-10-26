import { prisma } from "@/lib/prisma";
import { assertPayPalSandboxStorage } from "@/lib/payments/paypal";

async function main() {
  assertPayPalSandboxStorage();
  const instanceId = process.env.PAYPAL_SANDBOX_INSTANCE_ID?.trim();
  if (!instanceId || instanceId.length < 16) {
    throw new Error("PAYPAL_SANDBOX_INSTANCE_ID minimal 16 karakter wajib diisi.");
  }
  await prisma.payPalSandboxEnvironment.upsert({
    where: { id: "paypal-sandbox" },
    create: { id: "paypal-sandbox", instanceId },
    update: { instanceId },
  });
  console.info("PayPal Sandbox database marker initialized.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Sandbox marker gagal dibuat.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
