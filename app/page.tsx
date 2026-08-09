// The dashboard's home page. This is a React Server Component, meaning it
// runs on the server and can query the database directly — no API round
// trip needed for the very first render. The <Dashboard> client component
// then takes over for anything that needs to update live in the browser
// (the 30s polling, the chart/table toggle).

import { prisma } from "@/lib/db";
import Dashboard from "./components/Dashboard";

// Without this, Next.js would try to statically prerender this page at
// build time (baking in whatever readings existed then) rather than
// querying the database fresh on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const mac = process.env.PI_MAC_ADDRESS ?? "";

  type ReadingRow = { id: string; timestamp: Date; averageWeight: number };

  // Only query if PI_MAC_ADDRESS is actually configured — an empty string
  // as a `where` filter would technically run, but "show nothing because
  // nothing matches an empty MAC" is more confusing than "show nothing
  // because we skipped the query," so we short-circuit instead.
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
      // Server Components can pass plain serializable data to Client
      // Components, but not JS objects like Date — so timestamps get
      // converted to ISO strings here and parsed back into Dates in the
      // browser where needed (e.g. WeightChart.tsx).
      initialReadings={readings.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        averageWeight: r.averageWeight,
      }))}
    />
  );
}
