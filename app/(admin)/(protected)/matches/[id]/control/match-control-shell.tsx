"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useEventStream } from "@/lib/hooks/useEventStream";
import type { RealtimeEvent } from "@/lib/redis";

type Participant = {
  id: string;
  playerId: string;
  voteCount: number;
  result: string;
  player: { id: string; name: string; photoUrl: string | null; status: string };
};

type MatchWithParticipants = {
  id: string;
  position: number;
  state: string;
  survivorsCount: number;
  participants: Participant[];
};

type TieState = { tiedPlayerIds: string[]; remainingSlots: number };

const STATE_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  revealed: "Revealed",
  archived: "Archived",
};

const RESULT_LABEL: Record<string, string> = {
  advanced: "Advances",
  winner: "Champion",
  eliminated: "Eliminated",
};

export function MatchControlShell({ initialMatch }: { initialMatch: MatchWithParticipants }) {
  const [match, setMatch] = useState(initialMatch);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tie, setTie] = useState<TieState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refetch = useCallback(async () => {
    const response = await fetch(`/api/matches/${initialMatch.id}`);
    if (response.ok) {
      const data = await response.json();
      setMatch(data.match);
    }
  }, [initialMatch.id]);

  // Admin's own SSE subscription (gets tally_update in addition to state
  // events) — separate from the public stream audience/bigscreen use.
  useEventStream<RealtimeEvent>("/api/stream/admin", {
    onOpen: refetch,
    onMessage: (event) => {
      if ("matchId" in event && event.matchId === initialMatch.id) refetch();
    },
  });

  async function handleTransition(
    action: "open" | "close" | "reopen" | "reveal",
    body?: { resolveTieWith: string[] },
  ) {
    setSubmitting(true);
    setActionError(null);
    if (!body) setTie(null);

    const response = await fetch(`/api/matches/${match.id}/${action}`, {
      method: "POST",
      ...(body && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setActionError(data?.error ?? "Something went wrong");
      setTie(data?.code === "tie_detected" ? data.tie : null);
      setSubmitting(false);
      return;
    }

    setTie(null);
    await refetch();
    setSubmitting(false);
  }

  const showFinalTallies = match.state === "closed" || match.state === "revealed";
  const displayParticipants = showFinalTallies
    ? [...match.participants].sort((a, b) => b.voteCount - a.voteCount)
    : match.participants;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-2">
        <Link href="/matches" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
          ← Matches
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Match {match.position} control
        </h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {STATE_LABEL[match.state] ?? match.state}
        </span>
      </div>

      {actionError && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      )}

      <ul className="mb-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {displayParticipants.map((participant) => (
          <li key={participant.id} className="flex items-center gap-4 px-4 py-3">
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              {participant.player.photoUrl && (
                <Image
                  src={participant.player.photoUrl}
                  alt={participant.player.name}
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {participant.player.name}
            </span>
            {showFinalTallies && participant.result !== "pending" && (
              <span
                className={
                  participant.result === "eliminated"
                    ? "text-xs text-zinc-500 dark:text-zinc-400"
                    : "text-xs font-medium text-amber-600 dark:text-amber-400"
                }
              >
                {RESULT_LABEL[participant.result]}
              </span>
            )}
            <span className="w-10 text-right text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
              {participant.voteCount}
            </span>
          </li>
        ))}
      </ul>

      {tie ? (
        <TieBreakPanel
          tie={tie}
          participants={match.participants}
          submitting={submitting}
          onResolve={(resolveTieWith) => handleTransition("reveal", { resolveTieWith })}
        />
      ) : (
        <PrimaryAction state={match.state} submitting={submitting} onAction={handleTransition} />
      )}
    </div>
  );
}

function TieBreakPanel({
  tie,
  participants,
  submitting,
  onResolve,
}: {
  tie: TieState;
  participants: Participant[];
  submitting: boolean;
  onResolve: (chosenPlayerIds: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const tiedParticipants = participants.filter((p) => tie.tiedPlayerIds.includes(p.playerId));

  function toggle(playerId: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else if (next.size < tie.remainingSlots) {
        next.add(playerId);
      }
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
      <p className="mb-3 text-sm font-medium text-amber-900 dark:text-amber-200">
        Pick {chosen.size} of {tie.remainingSlots} remaining spot
        {tie.remainingSlots === 1 ? "" : "s"}
      </p>
      <ul className="mb-4 space-y-1">
        {tiedParticipants.map((participant) => (
          <li key={participant.id}>
            <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={chosen.has(participant.playerId)}
                onChange={() => toggle(participant.playerId)}
                disabled={
                  !chosen.has(participant.playerId) && chosen.size >= tie.remainingSlots
                }
              />
              {participant.player.name}
            </label>
          </li>
        ))}
      </ul>
      <button
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        disabled={submitting || chosen.size !== tie.remainingSlots}
        onClick={() => onResolve(Array.from(chosen))}
      >
        {submitting ? "Resolving…" : "Resolve & reveal"}
      </button>
    </div>
  );
}

function PrimaryAction({
  state,
  submitting,
  onAction,
}: {
  state: string;
  submitting: boolean;
  onAction: (action: "open" | "close" | "reopen" | "reveal") => void;
}) {
  const primaryClass =
    "rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
  const secondaryClass =
    "rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300";

  if (state === "scheduled") {
    return (
      <div className="flex items-center gap-3">
        <button className={primaryClass} disabled={submitting} onClick={() => onAction("open")}>
          {submitting ? "Opening…" : "Open voting"}
        </button>
        <button
          className={secondaryClass}
          disabled={submitting}
          onClick={() => onAction("close")}
          title="Skip voting for this match entirely"
        >
          Force close
        </button>
      </div>
    );
  }
  if (state === "open") {
    return (
      <button className={primaryClass} disabled={submitting} onClick={() => onAction("close")}>
        {submitting ? "Closing…" : "Close voting"}
      </button>
    );
  }
  if (state === "closed") {
    return (
      <div className="flex items-center gap-3">
        <button className={primaryClass} disabled={submitting} onClick={() => onAction("reveal")}>
          {submitting ? "Revealing…" : "Reveal results"}
        </button>
        <button
          className={secondaryClass}
          disabled={submitting}
          onClick={() => onAction("reopen")}
          title="Undo an accidental close and resume voting"
        >
          Reopen voting
        </button>
      </div>
    );
  }
  return null;
}
