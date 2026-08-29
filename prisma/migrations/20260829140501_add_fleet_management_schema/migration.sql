-- CreateEnum
CREATE TYPE "PiStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'DISABLED');

-- DropIndex
DROP INDEX "WeightReading_piMacAddress_timestamp_key";

-- AlterTable
ALTER TABLE "WeightReading" DROP COLUMN "piMacAddress",
ADD COLUMN     "boardId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Pi" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tailscaleName" TEXT NOT NULL,
    "resolvedIp" TEXT,
    "ipResolvedAt" TIMESTAMP(3),
    "sshUser" TEXT NOT NULL DEFAULT 'pi',
    "sshPublicKey" TEXT,
    "sshPrivateKeyEncrypted" TEXT,
    "assignedPort" INTEGER NOT NULL,
    "status" "PiStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "lastDeployedSha" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "piId" TEXT NOT NULL,
    "bluetoothMac" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerConfig" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pi_assignedPort_key" ON "Pi"("assignedPort");

-- CreateIndex
CREATE UNIQUE INDEX "Board_piId_slotIndex_key" ON "Board"("piId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Board_piId_bluetoothMac_key" ON "Board"("piId", "bluetoothMac");

-- CreateIndex
CREATE UNIQUE INDEX "WeightReading_boardId_timestamp_key" ON "WeightReading"("boardId", "timestamp");

-- AddForeignKey
ALTER TABLE "Pi" ADD CONSTRAINT "Pi_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_piId_fkey" FOREIGN KEY ("piId") REFERENCES "Pi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightReading" ADD CONSTRAINT "WeightReading_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

