-- CreateEnum
CREATE TYPE "PiStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'DISABLED');

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

-- AddForeignKey
ALTER TABLE "Pi" ADD CONSTRAINT "Pi_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_piId_fkey" FOREIGN KEY ("piId") REFERENCES "Pi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add boardId nullable first, not NOT NULL yet - existing WeightReading rows
-- (captured before per-board attribution existed, tagged only by a flat
-- piMacAddress string) need a real Board to point at before the column can
-- be required. The backfill below creates one placeholder "legacy" Pi/Board
-- (and a User to own it, since Pi.userId is required) ONLY if there's
-- existing data to attach it to - a fresh install with no WeightReading
-- rows yet skips all of this and just ends up with boardId NOT NULL on an
-- empty table, same as if it had been declared NOT NULL from the start.
ALTER TABLE "WeightReading" ADD COLUMN "boardId" TEXT;

DO $$
DECLARE
  legacy_user_id TEXT := 'legacy00000000000000000001';
  legacy_pi_id TEXT := 'legacy00000000000000000002';
  legacy_board_id TEXT := 'legacy00000000000000000003';
BEGIN
  IF EXISTS (SELECT 1 FROM "WeightReading" LIMIT 1) THEN
    INSERT INTO "User" (id, email, "hashedPassword", role, "createdAt")
    VALUES (legacy_user_id, 'legacy-placeholder@internal.invalid', 'unusable', 'ADMIN', CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO "Pi" (id, name, "userId", "tailscaleName", "assignedPort", status, "createdAt")
    VALUES (legacy_pi_id, 'Legacy (pre-fleet-management) Pi', legacy_user_id, 'unknown', 49999, 'DISABLED', CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO "Board" (id, "piId", "bluetoothMac", label, "slotIndex", "createdAt")
    VALUES (legacy_board_id, legacy_pi_id, '00:00:00:00:00:00', 'Legacy readings (pre-fleet-management)', 0, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;

    UPDATE "WeightReading" SET "boardId" = legacy_board_id WHERE "boardId" IS NULL;
  END IF;
END $$;

-- DropIndex
DROP INDEX "WeightReading_piMacAddress_timestamp_key";

-- AlterTable
ALTER TABLE "WeightReading" DROP COLUMN "piMacAddress",
ALTER COLUMN "boardId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WeightReading_boardId_timestamp_key" ON "WeightReading"("boardId", "timestamp");

-- AddForeignKey
ALTER TABLE "WeightReading" ADD CONSTRAINT "WeightReading_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
