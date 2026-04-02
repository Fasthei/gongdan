-- CreateTable: ApiModulePermission
CREATE TABLE IF NOT EXISTS "ApiModulePermission" (
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "ApiModulePermission_pkey" PRIMARY KEY ("moduleKey")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApiModulePermission_enabled_idx" ON "ApiModulePermission"("enabled");

-- CreateTable: AuthRefreshSession
CREATE TABLE IF NOT EXISTS "AuthRefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AuthRefreshSession_jti_key" ON "AuthRefreshSession"("jti");
CREATE INDEX IF NOT EXISTS "AuthRefreshSession_userId_role_idx" ON "AuthRefreshSession"("userId", "role");
CREATE INDEX IF NOT EXISTS "AuthRefreshSession_jti_idx" ON "AuthRefreshSession"("jti");
