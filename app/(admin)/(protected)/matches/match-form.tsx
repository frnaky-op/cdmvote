"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ActivePlayer = { id: string; name: string };

type MatchFormProps = {
  activePlayers: ActivePlayer[];
  match?: {
    id: string;
    position: number;
    survivorsCount: number;
    state: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    participantPlayerIds: string[];
  };
};

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  return value.slice(0, 16);
}

export function MatchForm({ activePlayers, match }: MatchFormProps) {
  const router = useRouter();
  const participantsLocked = Boolean(match) && match!.state !== "scheduled";

  const [position, setPosition] = useState(match?.position?.toString() ?? "");
  const [survivorsCount, setSurvivorsCount] = useState(match?.survivorsCount?.toString() ?? "");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(
    new Set(match?.participantPlayerIds ?? []),
  );
  const [scheduledStart, setScheduledStart] = useState(toDatetimeLocal(match?.scheduledStart ?? null));
  const [scheduledEnd, setScheduledEnd] = useState(toDatetimeLocal(match?.scheduledEnd ?? null));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function togglePlayer(id: string) {
    if (participantsLocked) return;
    setSelectedPlayerIds((prev) => {
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
        participantPlayerIds: Array.from(selectedPlayerIds),
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
            Position
          </label>
          <input
            id="position"
            type="number"
            min={1}
            required
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
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
          Participants{" "}
          {participantsLocked && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              (locked — voting has already started for this match)
            </span>
          )}
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
