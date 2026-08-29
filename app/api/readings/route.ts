// GET /api/readings — returns all weight readings for one board, oldest
// first. The dashboard's initial render fetches straight from the database
// (see app/page.tsx), but this endpoint is what the client-side chart polls
// every 30s afterwards to pick up new readings without a full page reload.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const requestedBoardId = request.nextUrl.searchParams.get("boardId");

  // Ownership is really "which Pi is this user's" (Pi.userId), not a
  // separate field on Board - this join is how every board access gets
  // scoped to boards the signed-in user can actually see, same as
  // app/page.tsx's initial query. findFirst rather than findUnique when a
  // boardId is given so an id that exists but isn't this user's board
  // resolves to "not found" (falls through to the no-board response
  // below) instead of leaking whether that id exists at all.
  const board = requestedBoardId
    ? await prisma.board.findFirst({
        where: { id: requestedBoardId, pi: { userId: session.user.id } },
      })
    : await prisma.board.findFirst({
        where: { pi: { userId: session.user.id } },
        orderBy: { createdAt: "asc" },
      });

  if (!board) {
    // Either boardId was invalid/not theirs, or they have no boards at all
    // yet - both are a normal "nothing to show" dashboard state, not an
    // error, so this returns 200 with an empty result rather than 404.
    return NextResponse.json({ boardId: null, readings: [] });
  }

  const readings = await prisma.weightReading.findMany({
    where: { boardId: board.id },
    orderBy: { timestamp: "asc" }, // oldest first, so the chart draws left-to-right
    select: { id: true, timestamp: true, averageWeight: true },
  });

  return NextResponse.json({ boardId: board.id, readings });
}
