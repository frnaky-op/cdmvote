import { NextRequest, NextResponse } from "next/server";
import { castVote } from "@/lib/match-state";
import { getOrCreateVoterId } from "@/lib/voter";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const matchId = body?.matchId;
  const playerId = body?.playerId;

  if (typeof matchId !== "string" || typeof playerId !== "string") {
    return NextResponse.json(
      { error: "matchId and playerId are required" },
      { status: 400 },
    );
  }

  const voterId = await getOrCreateVoterId();
  const result = await castVote({ matchId, playerId, voterId });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ alreadyVoted: result.alreadyVoted, votedPlayerId: result.votedPlayerId });
}
