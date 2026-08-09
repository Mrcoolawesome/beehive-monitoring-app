-- CreateTable
CREATE TABLE "WeightReading" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "averageWeight" DOUBLE PRECISION NOT NULL,
    "piMacAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeightReading_piMacAddress_timestamp_idx" ON "WeightReading"("piMacAddress", "timestamp");
