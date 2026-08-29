-- CreateEnum
CREATE TYPE "PiPendingAction" AS ENUM ('RESYNC_IP', 'INITIAL_SETUP');

-- AlterTable
ALTER TABLE "Pi" ADD COLUMN     "lastActionError" TEXT,
ADD COLUMN     "pendingAction" "PiPendingAction",
ADD COLUMN     "pendingActionRequestedAt" TIMESTAMP(3);

