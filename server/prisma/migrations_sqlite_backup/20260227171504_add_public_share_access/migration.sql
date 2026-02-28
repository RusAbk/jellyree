-- CreateTable
CREATE TABLE "PublicShareAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "accessMode" TEXT NOT NULL DEFAULT 'LINK',
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicShareAccess_token_key" ON "PublicShareAccess"("token");

-- CreateIndex
CREATE INDEX "PublicShareAccess_ownerId_resourceType_idx" ON "PublicShareAccess"("ownerId", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "PublicShareAccess_resourceType_resourceId_key" ON "PublicShareAccess"("resourceType", "resourceId");
