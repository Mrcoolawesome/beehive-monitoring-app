-- AlterEnum
ALTER TYPE "PiPendingAction" ADD VALUE 'SCAN_FOR_BOARDS';

-- AlterTable
ALTER TABLE "Pi" ADD COLUMN     "lastScanAt" TIMESTAMP(3),
ADD COLUMN     "lastScanResults" JSONB;

