-- DropIndex
DROP INDEX "WeightReading_piMacAddress_timestamp_idx";

-- CreateIndex
CREATE UNIQUE INDEX "WeightReading_piMacAddress_timestamp_key" ON "WeightReading"("piMacAddress", "timestamp");
