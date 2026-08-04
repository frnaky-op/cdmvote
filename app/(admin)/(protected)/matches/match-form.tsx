"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ActivePlayer = { id: string; name: string };
type AvailableMatch = {
  id: string;
  position: number;
  state: string;
  /** Planned survivor count before reveal; the actual advanced/winner count once revealed. */
  survivorsCount: number;
  advancedCount: number;
};

type MatchFormProps = {
  activePlayers: ActivePlayer[];
  availableParentMatches: AvailableMatch[];
  /** Next open position (max existing position + 1, or 1 if none exist) — used to
   * auto-fill Position for a brand new match. Ignored when editing. */
  defaultPosition?: number;
  match?: {
    id: string;
    position: number;
    survivorsCount: number;
    state: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    participantPlayerIds: string[];
    parentMatchIds: string[];
  };
};

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  return value.slice(0, 16);
}

export function MatchForm({
  activePlayers,
  availableParentMatches,
  defaultPosition,
  match,
}: MatchFormProps) {
  const router = useRouter();
  const participantsLocked = Boolean(match) && match!.state !== "scheduled";

  const [position, setPosition] = useState(
    match?.position?.toString() ?? defaultPosition?.toString() ?? "1",
  );
  const [survivorsCount, setSurvivorsCount] = useState(match?.survivorsCount?.toString() ?? "");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(
    new Set(match?.participantPlayerIds ?? []),
  );
  const [selectedParentIds, setSelectedParentIds] = useState<Set<string>>(
    new Set(match?.parentMatchIds ?? []),
  );
  const [scheduledStart, setScheduledStart] = useState(toDatetimeLocal(match?.scheduledStart ?? null));
  const [scheduledEnd, setScheduledEnd] = useState(toDatetimeLocal(match?.scheduledEnd ?? null));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sourceMode, setSourceMode] = useState<"players" | "matches">(
    (match?.parentMatchIds.length ?? 0) > 0 ? "matches" : "players",
  );

  const hasParents = sourceMode === "matches" && selectedParentIds.size > 0;
  const selectedParentTotal = availableParentMatches
    .filter((parentMatch) => selectedParentIds.has(parentMatch.id))
    .reduce((total, parentMatch) => {
      const isRevealed = parentMatch.state === "revealed" || parentMatch.state === "archived";
      return total + (isRevealed ? parentMatch.advancedCount : parentMatch.survivorsCount);
    }, 0);

  function switchSourceMode(mode: "players" | "matches") {
    if (participantsLocked || mode === sourceMode) return;
    setSourceMode(mode);
  }

  function togglePlayer(id: string) {
    if (participantsLocked || sourceMode !== "players") return;
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleParentMatch(id: string) {
    if (participantsLocked || sourceMode !== "matches") return;
    setSelectedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const url = match ? `/api/matches/${match.id}` : "/api/matches";
    const method = match ? "PATCH" : "POST";

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        position: Number(position),
        survivorsCount: Number(survivorsCount),
        participantPlayerIds: sourceMode === "matches" ? [] : Array.from(selectedPlayerIds),
        parentMatchIds: sourceMode === "matches" ? Array.from(selectedParentIds) : [],
        scheduledStart: scheduledStart || null,
        scheduledEnd: scheduledEnd || null,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Something went wrong");
      setSubmitting(false);
      return;
    }

    router.push("/matches");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="position" className="text-sm text-zinc-700 dark:text-zinc-300">
            Position{" "}
            {!match && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">(auto-assigned)</span>
            )}
          </label>
          <input
            id="position"
            type="number"
            min={1}
            required
            readOnly={!match}
            value={position}
            onChange={(event) => match && setPosition(event.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm read-only:bg-zinc-100 read-only:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:read-only:bg-zinc-900 dark:read-only:text-zinc-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="survivorsCount" className="text-sm text-zinc-700 dark:text-zinc-300">
            Survivors count
          </label>
          <input
            id="survivorsCount"
            type="number"
            min={1}
            required
            value={survivorsCount}
            onChange={(event) => setSurvivorsCount(event.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="scheduledStart" className="text-sm text-zinc-700 dark:text-zinc-300">
            Scheduled start (optional)
          </label>
          <input
            id="scheduledStart"
            type="datetime-local"
            value={scheduledStart}
            onChange={(event) => setScheduledStart(event.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="scheduledEnd" className="text-sm text-zinc-700 dark:text-zinc-300">
            Scheduled end (optional)
          </label>
          <input
            id="scheduledEnd"
            type="datetime-local"
            value={scheduledEnd}
            onChange={(event) => setScheduledEnd(event.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Participant source{" "}
          {participantsLocked && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              (locked — voting has already started for this match)
            </span>
          )}
        </p>
        <div className="inline-flex rounded border border-zinc-300 p-0.5 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => switchSourceMode("players")}
            disabled={participantsLocked}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              sourceMode === "players"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Choose players
          </button>
          <button
            type="button"
            onClick={() => switchSourceMode("matches")}
            disabled={participantsLocked}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              sourceMode === "matches"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            From parent matches
          </button>
        </div>
      </div>

      {sourceMode === "matches" ? (
        <div className="space-y-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Parent matches{" "}
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              (participants auto-fill from their survivors once all are revealed)
            </span>
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-zinc-300 p-2 dark:border-zinc-700">
            {availableParentMatches.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No other matches available.</p>
            )}
            {availableParentMatches.map((parentMatch) => {
              const isRevealed = parentMatch.state === "revealed" || parentMatch.state === "archived";
              const playerCount = isRevealed ? parentMatch.advancedCount : parentMatch.survivorsCount;
              return (
                <label
                  key={parentMatch.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={selectedParentIds.has(parentMatch.id)}
                    onChange={() => toggleParentMatch(parentMatch.id)}
                    disabled={participantsLocked}
                  />
                  <span className="flex-1">Match {parentMatch.position}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {playerCount} player{playerCount === 1 ? "" : "s"}
                    {!isRevealed && " (planned)"}
                  </span>
                </label>
              );
            })}
          </div>
          {hasParents && (
            <p className="rounded border border-zinc-300 p-2 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {selectedParentTotal} player{selectedParentTotal === 1 ? "" : "s"} will be auto-filled from
              these matches&apos; survivors once all are revealed.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Participants{" "}
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              ({selectedPlayerIds.size} selected)
            </span>
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-zinc-300 p-2 dark:border-zinc-700">
            {activePlayers.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No active players available.</p>
            )}
            {activePlayers.map((player) => (
              <label
                key={player.id}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.has(player.id)}
                  onChange={() => togglePlayer(player.id)}
                  disabled={participantsLocked}
                />
                {player.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {submitting ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
