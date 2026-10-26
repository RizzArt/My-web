CREATE TABLE "SecurityRateLimit" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminMfaCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminMfaCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminMfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminMfaEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminMfaEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityRateLimit_scope_keyHash_windowStart_key" ON "SecurityRateLimit"("scope", "keyHash", "windowStart");
CREATE INDEX "SecurityRateLimit_windowStart_idx" ON "SecurityRateLimit"("windowStart");
CREATE UNIQUE INDEX "AdminMfaCredential_userId_key" ON "AdminMfaCredential"("userId");
CREATE UNIQUE INDEX "AdminMfaRecoveryCode_codeHash_key" ON "AdminMfaRecoveryCode"("codeHash");
CREATE INDEX "AdminMfaRecoveryCode_credentialId_usedAt_idx" ON "AdminMfaRecoveryCode"("credentialId", "usedAt");
CREATE UNIQUE INDEX "AdminMfaEnrollment_userId_key" ON "AdminMfaEnrollment"("userId");
CREATE INDEX "AdminMfaEnrollment_expiresAt_idx" ON "AdminMfaEnrollment"("expiresAt");

ALTER TABLE "AdminMfaCredential" ADD CONSTRAINT "AdminMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminMfaRecoveryCode" ADD CONSTRAINT "AdminMfaRecoveryCode_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AdminMfaCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminMfaEnrollment" ADD CONSTRAINT "AdminMfaEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
