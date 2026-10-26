import { prisma } from "@/lib/prisma";

export const publicSettingFields = { id: true, storeName: true, storeEmail: true, supportEmail: true, whatsapp: true, logoUrl: true, faviconUrl: true, description: true, currency: true, timezone: true, orderPrefix: true, autoExpiryHours: true, manualPaymentTestMode: true, downloadExpiryDays: true, maxDownloadCount: true, deliverySenderEmail: true, deliveryRetryLimit: true, inventoryWarningThreshold: true, platformCommissionPercent: true, minimumWithdrawal: true, sellerSettlementDays: true, emailProvider: true, smtpHost: true, smtpPort: true, smtpSecure: true, smtpFrom: true, paymentProvider: true, paymentTestMode: true, updatedAt: true } as const;
export async function getStoreSettings() { return prisma.storeSetting.upsert({ where: { id: "default" }, create: {}, update: {}, select: publicSettingFields }); }
export function configured(name: string) { return Boolean(process.env[name]); }
