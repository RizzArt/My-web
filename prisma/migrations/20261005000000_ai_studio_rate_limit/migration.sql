CREATE TABLE "StudioRateLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioRateLimit_userId_windowStart_key" ON "StudioRateLimit"("userId", "windowStart");
CREATE INDEX "StudioRateLimit_windowStart_idx" ON "StudioRateLimit"("windowStart");
