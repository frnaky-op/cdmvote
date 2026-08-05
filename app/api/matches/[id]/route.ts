import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import { requireSession } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      participants: {
        include: { player: { select: { id: true, name: true, photoUrl: true, status: true } } },
      },
    },
  });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  return NextResponse.json({ match });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.match.findUnique({
    where: { id },
    include: { participants: true, parentLinks: true },
  });
  if (!existing) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const position = body?.position;
  const survivorsCount = body?.survivorsCount;
  const participantPlayerIds = body?.participantPlayerIds;
  const parentMatchIds: string[] = Array.isArray(body?.parentMatchIds) ? body.parentMatchIds : [];
  const scheduledStart = body?.scheduledStart;
  const scheduledEnd = body?.scheduledEnd;
  const hasParents = parentMatchIds.length > 0;

  if (!Number.isInteger(position) || position < 1) {
    return NextResponse.json({ error: "Position must be a positive integer" }, { status: 400 });
  }
  if (!Number.isInteger(survivorsCount) || survivorsCount < 1) {
    return NextResponse.json(
      { error: "Survivors count must be a positive integer" },
      { status: 400 },
    );
  }
  if (!hasParents) {
    if (!Array.isArray(participantPlayerIds) || participantPlayerIds.length === 0) {
      return NextResponse.json({ error: "At least one participant is required" }, { status: 400 });
    }
    if (survivorsCount >= participantPlayerIds.length) {
      return NextResponse.json(
        { error: "Survivors count must be less than the number of participants" },
        { status: 400 },
      );
    }
  }

  const existingParentIds = new Set(existing.parentLinks.map((p) => p.parentMatchId));
  const nextParentIds = new Set(parentMatchIds);
  const parentsChanged =
    existingParentIds.size !== nextParentIds.size ||
    [...existingParentIds].some((parentMatchId) => !nextParentIds.has(parentMatchId));

  if (parentsChanged && existing.state !== "scheduled") {
    return NextResponse.json(
      { error: "Cannot change parent matches once a match has moved past scheduled" },
      { status: 409 },
    );
  }

  const existingParticipantIds = new Set(existing.participants.map((p) => p.playerId));
  const nextParticipantIds = new Set<string>(hasParents ? [] : participantPlayerIds);
  const participantsChanged =
    !hasParents &&
    (existingParticipantIds.size !== nextParticipantIds.size ||
      [...existingParticipantIds].some((playerId) => !nextParticipantIds.has(playerId)));

  if (participantsChanged && existing.state !== "scheduled") {
    return NextResponse.json(
      { error: "Cannot change participants once a match has moved past scheduled" },
      { status: 409 },
    );
  }

  if (hasParents && parentsChanged) {
    const parentMatches = await prisma.match.findMany({
      where: { id: { in: parentMatchIds } },
      select: { id: true },
    });
    if (parentMatches.length !== parentMatchIds.length) {
      return NextResponse.json({ error: "One or more parent matches not found" }, { status: 400 });
    }
  }

  if (!hasParents && participantsChanged) {
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
  }

  try {
    const match = await prisma.$transaction(async (tx) => {
      const updated = await tx.match.update({
        where: { id },
        data: {
          position,
          survivorsCount,
          scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
          scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        },
      });

      if (parentsChanged) {
        await tx.matchParent.deleteMany({ where: { matchId: id } });
        if (hasParents) {
          await tx.matchParent.createMany({
            data: parentMatchIds.map((parentMatchId) => ({ matchId: id, parentMatchId })),
          });
          // Switching a match to parent-driven clears any manually-picked
          // participants — they'll be auto-filled once parents are revealed.
          await tx.matchParticipant.deleteMany({ where: { matchId: id } });
        }
      }

      if (!hasParents && participantsChanged) {
        await tx.matchParticipant.deleteMany({ where: { matchId: id } });
        await tx.matchParticipant.createMany({
          data: participantPlayerIds.map((playerId: string) => ({
            matchId: id,
            playerId,
          })),
        });
      }

      return updated;
    });

    return NextResponse.json({ match });
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
