import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import { requireSession } from "@/lib/session";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const matches = await prisma.match.findMany({
    orderBy: { position: "asc" },
    include: { _count: { select: { participants: true } } },
  });
  return NextResponse.json({ matches });
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const position = body?.position;
  const survivorsCount = body?.survivorsCount;
  const participantPlayerIds = body?.participantPlayerIds;
  const scheduledStart = body?.scheduledStart;
  const scheduledEnd = body?.scheduledEnd;

  if (!Number.isInteger(position) || position < 1) {
    return NextResponse.json({ error: "Position must be a positive integer" }, { status: 400 });
  }
  if (!Number.isInteger(survivorsCount) || survivorsCount < 1) {
    return NextResponse.json(
      { error: "Survivors count must be a positive integer" },
      { status: 400 },
    );
  }
  if (!Array.isArray(participantPlayerIds) || participantPlayerIds.length === 0) {
    return NextResponse.json({ error: "At least one participant is required" }, { status: 400 });
  }
  if (survivorsCount >= participantPlayerIds.length) {
    return NextResponse.json(
      { error: "Survivors count must be less than the number of participants" },
      { status: 400 },
    );
  }

  const tournament = await prisma.tournament.findFirst();
  if (!tournament) {
    return NextResponse.json(
      { error: "No tournament exists — run the seed script first" },
      { status: 500 },
    );
  }

  const activePlayers = await prisma.player.findMany({
    where: { id: { in: participantPlayerIds }, status: "active" },
    select: { id: true },
  });
  if (activePlayers.length !== participantPlayerIds.length) {
    return NextResponse.json(
      { error: "All participants must be currently-active players" },
      { status: 400 },
    );
  }

  try {
    const match = await prisma.$transaction(async (tx) => {
      const created = await tx.match.create({
        data: {
          tournamentId: tournament.id,
          position,
          survivorsCount,
          scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
          scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        },
      });
      await tx.matchParticipant.createMany({
        data: participantPlayerIds.map((playerId: string) => ({
          matchId: created.id,
          playerId,
        })),
      });
      return created;
    });

    return NextResponse.json({ match }, { status: 201 });
  } catch (error: unknown) {
    if (isUniqueConstraintViolation(error)) {
      return NextResponse.json(
        { error: "A match already exists at this position" },
        { status: 409 },
      );
    }
    throw error;
  }
}
