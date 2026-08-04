import type { Match } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import { publishToAdmin, publishToPublic } from "@/lib/redis";

export type CurrentMatchStatus = {
  match: {
    id: string;
    position: number;
    state: string;
    survivorsCount: number;
  } | null;
  participants: { id: string; name: string; photoUrl: string | null }[];
  hasVoted: boolean;
  votedPlayerId: string | null;
};

/**
 * The currently open match (if any) plus, for a given voter, whether they've
 * already voted in it. Never includes vote counts — audience and bigscreen
 * stay blind during voting by design.
 */
export async function getCurrentMatchStatus(
  voterId: string | null,
): Promise<CurrentMatchStatus> {
  const match = await prisma.match.findFirst({
    where: { state: "open" },
    include: {
      participants: {
        include: { player: { select: { id: true, name: true, photoUrl: true } } },
      },
    },
  });

  if (!match) {
    return { match: null, participants: [], hasVoted: false, votedPlayerId: null };
  }

  const participants = match.participants.map((participant) => ({
    id: participant.player.id,
    name: participant.player.name,
    photoUrl: participant.player.photoUrl,
  }));

  let hasVoted = false;
  let votedPlayerId: string | null = null;

  if (voterId) {
    const vote = await prisma.vote.findUnique({
      where: { matchId_voterId: { matchId: match.id, voterId } },
    });
    if (vote) {
      hasVoted = true;
      votedPlayerId = vote.playerId;
    }
  }

  return {
    match: {
      id: match.id,
      position: match.position,
      state: match.state,
      survivorsCount: match.survivorsCount,
    },
    participants,
    hasVoted,
    votedPlayerId,
  };
}

export type BigscreenStatus = {
  match: {
    id: string;
    position: number;
    state: string;
    survivorsCount: number;
  } | null;
  participants: { id: string; name: string; photoUrl: string | null }[];
  /** Ascending by vote count (lowest first) — the reveal-animation order.
   * Vote counts themselves are never exposed, only this ordering. */
  results: { playerId: string; result: string }[] | null;
  totalMatches: number;
  /** Set once the final (survivorsCount === 1) match has been revealed —
   * IDLE renders the champion instead of generic branding when this is set
   * and no match is currently in flight. */
  tournamentWinner: { id: string; name: string; photoUrl: string | null } | null;
};

/**
 * The match currently "in flight" (open, closed-but-not-revealed, or just
 * revealed) — the bigscreen's IDLE/OPEN/TALLYING/REVEAL states map directly
 * onto match/state here. Never includes vote counts (only `results`, and
 * only once revealed). `archived` is deliberately excluded: once an admin
 * archives a revealed match, there's nothing left to distinguish it from a
 * true gap, and no event is published on archive, so bigscreen simply holds
 * its last REVEAL state until the next match_opened event moves it on.
 */
export async function getBigscreenStatus(): Promise<BigscreenStatus> {
  const tournament = await prisma.tournament.findFirst();
  if (!tournament) {
    return { match: null, participants: [], results: null, totalMatches: 0, tournamentWinner: null };
  }

  const [match, totalMatches, finalMatch] = await Promise.all([
    prisma.match.findFirst({
      where: { tournamentId: tournament.id, state: { in: ["open", "closed", "revealed"] } },
      // Normally at most one match is in-flight at a time, but if an admin
      // opens the next match before archiving the previous one, more than
      // one can qualify — prefer the highest position (the most recent).
      orderBy: { position: "desc" },
      include: {
        participants: {
          include: { player: { select: { id: true, name: true, photoUrl: true } } },
        },
      },
    }),
    prisma.match.count({ where: { tournamentId: tournament.id } }),
    prisma.match.findFirst({
      where: {
        tournamentId: tournament.id,
        survivorsCount: 1,
        state: { in: ["revealed", "archived"] },
      },
      // In a real tournament only the true final has survivorsCount === 1,
      // but prefer the highest position defensively in case more than one
      // ever qualifies.
      orderBy: { position: "desc" },
      include: {
        participants: {
          where: { result: "winner" },
          include: { player: { select: { id: true, name: true, photoUrl: true } } },
        },
      },
    }),
  ]);

  const tournamentWinner = finalMatch?.participants[0]?.player ?? null;

  if (!match) {
    return { match: null, participants: [], results: null, totalMatches, tournamentWinner };
  }

  const sortedParticipants = [...match.participants].sort((a, b) => a.voteCount - b.voteCount);

  return {
    match: {
      id: match.id,
      position: match.position,
      state: match.state,
      survivorsCount: match.survivorsCount,
    },
    participants: match.participants.map((participant) => ({
      id: participant.player.id,
      name: participant.player.name,
      photoUrl: participant.player.photoUrl,
    })),
    results:
      match.state === "revealed"
        ? sortedParticipants.map((p) => ({ playerId: p.playerId, result: p.result }))
        : null,
    totalMatches,
    tournamentWinner,
  };
}

export type TransitionError = {
  ok: false;
  error: string;
  status: number;
  code?: string;
  tie?: TieInfo;
};

export type CastVoteResult =
  | { ok: true; alreadyVoted: boolean; votedPlayerId: string }
  | TransitionError;

/**
 * Casts a vote. Only accepted while the match is `open`. Relies on the
 * DB-level unique constraint on (matchId, voterId) as the source of truth
 * for "one vote per person" — a double-tap or two-tab race that both pass
 * the open-match check still only produces one Vote row, and the second
 * request is reported back as `alreadyVoted: true` rather than an error.
 */
export async function castVote({
  matchId,
  playerId,
  voterId,
}: {
  matchId: string;
  playerId: string;
  voterId: string;
}): Promise<CastVoteResult> {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return { ok: false, error: "Match not found", status: 404 };
  if (match.state !== "open") {
    return { ok: false, error: "This match is not open for voting", status: 409 };
  }

  const participant = await prisma.matchParticipant.findUnique({
    where: { matchId_playerId: { matchId, playerId } },
  });
  if (!participant) {
    return { ok: false, error: "That player is not in this match", status: 400 };
  }

  try {
    await prisma.$transaction([
      prisma.vote.create({ data: { matchId, playerId, voterId } }),
      prisma.matchParticipant.update({
        where: { matchId_playerId: { matchId, playerId } },
        data: { voteCount: { increment: 1 } },
      }),
    ]);

    const participants = await prisma.matchParticipant.findMany({ where: { matchId } });
    await publishToAdmin(match.tournamentId, {
      type: "tally_update",
      matchId,
      tallies: participants.map((p) => ({ playerId: p.playerId, voteCount: p.voteCount })),
    });

    return { ok: true, alreadyVoted: false, votedPlayerId: playerId };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const existingVote = await prisma.vote.findUnique({
        where: { matchId_voterId: { matchId, voterId } },
      });
      // existingVote is guaranteed by the constraint we just hit
      return { ok: true, alreadyVoted: true, votedPlayerId: existingVote!.playerId };
    }
    throw error;
  }
}

/** scheduled -> open. Idempotent if already open. */
export async function openMatch(
  matchId: string,
): Promise<{ ok: true; match: Match } | TransitionError> {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return { ok: false, error: "Match not found", status: 404 };
  if (match.state === "open") return { ok: true, match };
  if (match.state !== "scheduled") {
    return { ok: false, error: `Cannot open a match in state "${match.state}"`, status: 409 };
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data: { state: "open", openedAt: new Date() },
  });

  const event = { type: "match_opened" as const, matchId };
  await publishToPublic(match.tournamentId, event);
  await publishToAdmin(match.tournamentId, event);

  return { ok: true, match: updated };
}

/**
 * open -> closed (the normal path), or scheduled -> closed ("force-close":
 * skip voting entirely for a match the admin decides not to run — tallies
 * will naturally all be zero, which the tie-break flow below already
 * handles). Reconciles MatchParticipant.voteCount from a fresh
 * COUNT ... GROUP BY over the Vote table (the source of truth) rather than
 * trusting the denormalized counters, which only exist as a live-display
 * fast path. Idempotent if already closed or later.
 */
export async function closeMatch(matchId: string): Promise<
  | { ok: true; match: Match; tallies: { playerId: string; voteCount: number }[] }
  | TransitionError
> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });
  if (!match) return { ok: false, error: "Match not found", status: 404 };

  if (match.state === "closed" || match.state === "revealed" || match.state === "archived") {
    return {
      ok: true,
      match,
      tallies: match.participants.map((p) => ({ playerId: p.playerId, voteCount: p.voteCount })),
    };
  }
  if (match.state !== "open" && match.state !== "scheduled") {
    return { ok: false, error: `Cannot close a match in state "${match.state}"`, status: 409 };
  }

  const grouped = await prisma.vote.groupBy({
    by: ["playerId"],
    where: { matchId },
    _count: true,
  });
  const countByPlayerId = new Map(grouped.map((g) => [g.playerId, g._count]));

  await prisma.$transaction([
    prisma.match.update({
      where: { id: matchId },
      data: { state: "closed", closedAt: new Date() },
    }),
    ...match.participants.map((participant) =>
      prisma.matchParticipant.update({
        where: { matchId_playerId: { matchId, playerId: participant.playerId } },
        data: { voteCount: countByPlayerId.get(participant.playerId) ?? 0 },
      }),
    ),
  ]);

  const updatedMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });

  const event = { type: "match_closed" as const, matchId };
  await publishToPublic(match.tournamentId, event);
  await publishToAdmin(match.tournamentId, event);

  return {
    ok: true,
    match: updatedMatch!,
    tallies: updatedMatch!.participants.map((p) => ({
      playerId: p.playerId,
      voteCount: p.voteCount,
    })),
  };
}

/**
 * closed -> open. Manual override for an accidental/premature close —
 * scoped to closed only, not revealed (undoing a reveal would mean
 * reverting Player.status changes too, a bigger operation this doesn't
 * attempt). Votes already cast are untouched; voting simply resumes.
 * Idempotent if already open.
 */
export async function reopenMatch(
  matchId: string,
): Promise<{ ok: true; match: Match } | TransitionError> {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return { ok: false, error: "Match not found", status: 404 };
  if (match.state === "open") return { ok: true, match };
  if (match.state !== "closed") {
    return { ok: false, error: `Cannot reopen a match in state "${match.state}"`, status: 409 };
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data: { state: "open", closedAt: null },
  });

  const event = { type: "match_opened" as const, matchId };
  await publishToPublic(match.tournamentId, event);
  await publishToAdmin(match.tournamentId, event);

  return { ok: true, match: updated };
}

export type TieInfo = { tiedPlayerIds: string[]; remainingSlots: number };

/**
 * closed -> revealed. Computes the top-`survivorsCount` participants by
 * (reconciled) vote count and updates both MatchParticipant.result and
 * Player.status — the latter is what makes survivors show up in the next
 * match's active-players picker, so both must be kept in sync.
 *
 * Per the project's confirmed design, ties at the cutoff line are never
 * auto-resolved. If detected and `resolveTieWith` isn't provided, reveal is
 * refused (409, code "tie_detected") with a `tie` payload describing which
 * players are tied and how many of them can advance — the admin picks
 * exactly that many and retries with `resolveTieWith` set to their choice.
 * The choice is re-validated against a fresh computation here, not trusted
 * from the client.
 *
 * Idempotent if already revealed or archived: returns the existing result
 * rather than recomputing, since redoing this could flip Player.status
 * again or re-trigger the bigscreen reveal animation for a live audience.
 */
export async function revealMatch(
  matchId: string,
  resolveTieWith?: string[],
): Promise<
  | { ok: true; match: Match; results: { playerId: string; result: string }[] }
  | TransitionError
> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });
  if (!match) return { ok: false, error: "Match not found", status: 404 };

  if (match.state === "revealed" || match.state === "archived") {
    return {
      ok: true,
      match,
      results: [...match.participants]
        .sort((a, b) => a.voteCount - b.voteCount)
        .map((p) => ({ playerId: p.playerId, result: p.result })),
    };
  }
  if (match.state !== "closed") {
    return { ok: false, error: `Cannot reveal a match in state "${match.state}"`, status: 409 };
  }

  const sorted = [...match.participants].sort((a, b) => b.voteCount - a.voteCount);
  const cutoff = match.survivorsCount;

  const tieAtCutoff =
    cutoff < sorted.length && sorted[cutoff - 1].voteCount === sorted[cutoff].voteCount;

  let advanced: typeof sorted;
  let eliminated: typeof sorted;

  if (tieAtCutoff) {
    const tiedVoteCount = sorted[cutoff - 1].voteCount;
    const certain = sorted.filter((p) => p.voteCount > tiedVoteCount);
    const tiedGroup = sorted.filter((p) => p.voteCount === tiedVoteCount);
    const remainingSlots = cutoff - certain.length;

    const chosen = resolveTieWith
      ? tiedGroup.filter((p) => resolveTieWith.includes(p.playerId))
      : [];
    const validResolution =
      resolveTieWith !== undefined &&
      chosen.length === remainingSlots &&
      resolveTieWith.every((id) => tiedGroup.some((p) => p.playerId === id));

    if (!validResolution) {
      return {
        ok: false,
        error: `Tie detected at ${tiedVoteCount} vote${tiedVoteCount === 1 ? "" : "s"} — ${tiedGroup.length} players tied for ${remainingSlots} remaining spot${remainingSlots === 1 ? "" : "s"}`,
        status: 409,
        code: "tie_detected",
        tie: { tiedPlayerIds: tiedGroup.map((p) => p.playerId), remainingSlots },
      };
    }

    const chosenIds = new Set(chosen.map((p) => p.playerId));
    advanced = [...certain, ...chosen];
    eliminated = [
      ...sorted.filter((p) => p.voteCount < tiedVoteCount),
      ...tiedGroup.filter((p) => !chosenIds.has(p.playerId)),
    ];
  } else {
    advanced = sorted.slice(0, cutoff);
    eliminated = sorted.slice(cutoff);
  }

  const isFinal = match.survivorsCount === 1;

  await prisma.$transaction([
    prisma.match.update({
      where: { id: matchId },
      data: { state: "revealed", revealedAt: new Date() },
    }),
    ...advanced.map((participant) =>
      prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { result: isFinal ? "winner" : "advanced" },
      }),
    ),
    ...advanced.map((participant) =>
      prisma.player.update({
        where: { id: participant.playerId },
        data: { status: isFinal ? "winner" : "active" },
      }),
    ),
    ...eliminated.map((participant) =>
      prisma.matchParticipant.update({
        where: { id: participant.id },
        data: { result: "eliminated" },
      }),
    ),
    ...eliminated.map((participant) =>
      prisma.player.update({
        where: { id: participant.playerId },
        data: { status: "eliminated" },
      }),
    ),
  ]);

  const updatedMatch = await prisma.match.findUnique({
    where: { id: matchId },
    include: { participants: true },
  });
  // Ascending by vote count — the order the bigscreen reveal animation uses.
  const results = [...updatedMatch!.participants]
    .sort((a, b) => a.voteCount - b.voteCount)
    .map((p) => ({ playerId: p.playerId, result: p.result }));

  const event = { type: "match_revealed" as const, matchId, results };
  await publishToPublic(match.tournamentId, event);
  await publishToAdmin(match.tournamentId, event);

  return { ok: true, match: updatedMatch!, results };
}

/** revealed -> archived. Purely bookkeeping — survivors are already correct
 * from the reveal step. Idempotent if already archived. */
export async function archiveMatch(
  matchId: string,
): Promise<{ ok: true; match: Match } | TransitionError> {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return { ok: false, error: "Match not found", status: 404 };
  if (match.state === "archived") return { ok: true, match };
  if (match.state !== "revealed") {
    return { ok: false, error: `Cannot archive a match in state "${match.state}"`, status: 409 };
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data: { state: "archived" },
  });
  return { ok: true, match: updated };
}
