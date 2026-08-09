import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
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
    orderBy: { timestamp: "asc" },
    select: { id: true, timestamp: true, averageWeight: true },
  });

  return NextResponse.json({ mac, readings });
}
