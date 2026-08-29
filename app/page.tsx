// The dashboard's home page. This is a React Server Component, meaning it
// runs on the server and can query the database directly — no API round
// trip needed for the very first render. The <Dashboard> client component
// then takes over for anything that needs to update live in the browser
// (the 30s polling, the chart/table toggle, the board switcher).

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Dashboard from "./components/Dashboard";

// Without this, Next.js would try to statically prerender this page at
// build time (baking in whatever readings existed then) rather than
// querying the database fresh on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Every board across every Pi assigned to this user (Pi.userId) - a
  // VIEWER only ever sees their own boards here, never anyone else's; an
  // ADMIN sees the same thing on this page too (their own assigned Pis,
  // if any) - seeing every Pi in the fleet is what the separate /admin
  // section is for, not this page.
  const boards = await prisma.board.findMany({
    where: { pi: { userId: session.user.id } },
    include: { pi: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const defaultBoard = boards[0];

  type ReadingRow = { id: string; timestamp: Date; averageWeight: number };
  const readings: ReadingRow[] = defaultBoard
    ? await prisma.weightReading.findMany({
        where: { boardId: defaultBoard.id },
        orderBy: { timestamp: "asc" },
        select: { id: true, timestamp: true, averageWeight: true },
      })
    : [];

  return (
    <Dashboard
      boards={boards.map((b) => ({
        id: b.id,
        label: b.label,
        piName: b.pi.name,
      }))}
      initialBoardId={defaultBoard?.id ?? null}
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
