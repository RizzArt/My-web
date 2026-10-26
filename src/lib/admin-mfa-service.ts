import { prisma } from "@/lib/prisma";
import { decryptAdminMfaSecret, encryptAdminMfaSecret } from "@/lib/security/secrets";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, verifyTotpCode } from "@/lib/admin-mfa";

export async function startAdminMfaEnrollment(userId: string) {
  const secret = generateTotpSecret();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await prisma.adminMfaEnrollment.upsert({
    where: { userId },
    update: { secretEncrypted: encryptAdminMfaSecret(secret), expiresAt },
    create: { userId, secretEncrypted: encryptAdminMfaSecret(secret), expiresAt },
  });
  return { secret, expiresAt };
}

export async function confirmAdminMfaEnrollment(userId: string, code: string) {
  const enrollment = await prisma.adminMfaEnrollment.findUnique({ where: { userId } });
  if (!enrollment || enrollment.expiresAt.getTime() <= Date.now()) {
    if (enrollment) await prisma.adminMfaEnrollment.deleteMany({ where: { id: enrollment.id } });
    return null;
  }
  const secret = decryptAdminMfaSecret(enrollment.secretEncrypted);
  if (!verifyTotpCode(secret, code)) return null;
  const recoveryCodes = generateRecoveryCodes();
  const claimed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.adminMfaEnrollment.deleteMany({ where: { id: enrollment.id, userId, expiresAt: { gt: new Date() } } });
    if (deleted.count !== 1) return false;
    const credential = await tx.adminMfaCredential.upsert({
      where: { userId },
      update: { secretEncrypted: enrollment.secretEncrypted, enabledAt: new Date() },
      create: { userId, secretEncrypted: enrollment.secretEncrypted },
    });
    await tx.adminMfaRecoveryCode.deleteMany({ where: { credentialId: credential.id } });
    await tx.adminMfaRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ credentialId: credential.id, codeHash: hashRecoveryCode(value) })) });
    await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorId: userId, action: "ADMIN_MFA_ENROLLED", entityType: "User", entityId: userId } });
    return true;
  });
  return claimed ? recoveryCodes : null;
}

export async function verifyAdminMfaLogin(userId: string, code: string) {
  const credential = await prisma.adminMfaCredential.findUnique({ where: { userId }, select: { id: true, secretEncrypted: true } });
  if (!credential) return { required: false, verified: true };
  if (verifyTotpCode(decryptAdminMfaSecret(credential.secretEncrypted), code)) return { required: true, verified: true };
  const claimed = await prisma.adminMfaRecoveryCode.updateMany({
    where: { credentialId: credential.id, codeHash: hashRecoveryCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  return { required: true, verified: claimed.count === 1 };
}

export async function verifyFreshAdminMfa(userId: string, code: string) {
  const credential = await prisma.adminMfaCredential.findUnique({ where: { userId }, select: { id: true } });
  if (!credential) return false;
  return (await verifyAdminMfaLogin(userId, code)).verified;
}

export async function regenerateAdminMfaRecoveryCodes(userId: string, code: string) {
  const credential = await prisma.adminMfaCredential.findUnique({ where: { userId }, select: { id: true, secretEncrypted: true } });
  if (!credential || !verifyTotpCode(decryptAdminMfaSecret(credential.secretEncrypted), code)) return null;
  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.adminMfaRecoveryCode.deleteMany({ where: { credentialId: credential.id } });
    await tx.adminMfaRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ credentialId: credential.id, codeHash: hashRecoveryCode(value) })) });
    await tx.auditLog.create({ data: { actorId: userId, action: "ADMIN_MFA_RECOVERY_CODES_REGENERATED", entityType: "User", entityId: userId } });
  });
  return recoveryCodes;
}
