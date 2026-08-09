import { prisma } from "@/lib/db";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mac = process.env.PI_MAC_ADDRESS ?? "";

  type ReadingRow = { id: string; timestamp: Date; averageWeight: number };

  const readings: ReadingRow[] = mac
    ? await prisma.weightReading.findMany({
        where: { piMacAddress: mac },
        orderBy: { timestamp: "asc" },
        select: { id: true, timestamp: true, averageWeight: true },
      })
    : [];

  return (
    <Dashboard
      mac={mac}
      initialReadings={readings.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        averageWeight: r.averageWeight,
      }))}
    />
  );
}
