import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [matches, players] = await Promise.all([
    prisma.match.findMany({
      orderBy: { position: "asc" },
      include: {
        participants: { select: { playerId: true, result: true } },
        parentLinks: { select: { parentMatchId: true } },
      },
    }),
    prisma.player.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    }),
  ]);

  return NextResponse.json({ matches, players });
}
