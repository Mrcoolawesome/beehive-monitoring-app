// GET /api/readings — returns all weight readings for one Pi/hive, oldest
// first. The dashboard's initial render fetches straight from the database
// (see app/page.tsx), but this endpoint is what the client-side chart polls
// every 30s afterwards to pick up new readings without a full page reload.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  // ?mac=<address> lets a future multi-hive dashboard ask for a specific
  // Pi's readings. With only one hive today, this falls back to the
  // hardcoded PI_MAC_ADDRESS env var so the endpoint works with no query
  // params at all.
  const mac =
    request.nextUrl.searchParams.get("mac") ?? process.env.PI_MAC_ADDRESS;

  if (!mac) {
    return NextResponse.json(
      { error: "No piMacAddress provided and PI_MAC_ADDRESS is not set" },
      { status: 400 },
    );
  }

  const readings = await prisma.weightReading.findMany({
    where: { piMacAddress: mac },
    orderBy: { timestamp: "asc" }, // oldest first, so the chart draws left-to-right
    select: { id: true, timestamp: true, averageWeight: true },
  });

  return NextResponse.json({ mac, readings });
}
