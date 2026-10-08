-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalProvider" TEXT,
ADD COLUMN     "externalUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "externalUrl" TEXT;

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleConnection_userId_key" ON "GoogleConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Material_userId_externalProvider_externalId_key" ON "Material"("userId", "externalProvider", "externalId");

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

