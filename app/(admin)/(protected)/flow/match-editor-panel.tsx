"use client";

import { useState } from "react";

export type EditableMatch = {
  id: string;
  position: number;
  state: string;
  survivorsCount: number;
  participantPlayerIds: string[];
  parentMatchIds: string[];
};

type Player = { id: string; name: string; status: string };

type Props = {
  match: EditableMatch;
  allPlayers: Player[];
  parentCandidates: { id: string; position: number }[];
  onClose: () => void;
  onSave: (matchId: string, patch: { participantPlayerIds: string[]; parentMatchIds: string[] }) => void;
};

export function MatchEditorPanel({ match, allPlayers, parentCandidates, onClose, onSave }: Props) {
  const locked = match.state !== "scheduled";
  const [sourceMode, setSourceMode] = useState<"players" | "matches">(
    match.parentMatchIds.length > 0 ? "matches" : "players",
  );
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(new Set(match.participantPlayerIds));
  const [selectedParentIds, setSelectedParentIds] = useState(new Set(match.parentMatchIds));

  const selectablePlayers = allPlayers.filter(
    (player) => player.status === "active" || match.participantPlayerIds.includes(player.id),
  );

  function togglePlayer(id: string) {
    if (locked) return;
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleParent(id: string) {
    if (locked) return;
    setSelectedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSave() {
    onSave(match.id, {
      participantPlayerIds: sourceMode === "matches" ? [] : Array.from(selectedPlayerIds),
      parentMatchIds: sourceMode === "matches" ? Array.from(selectedParentIds) : [],
    });
  }

  return (
    <div className="absolute inset-y-0 right-0 z-10 flex w-80 flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Match {match.position} participants
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {locked && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Locked — this match has moved past scheduled.
        </p>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="inline-flex rounded border border-zinc-300 p-0.5 dark:border-zinc-700">
          <button
            type="button"
            disabled={locked}
            onClick={() => setSourceMode("players")}
            className={`rounded px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              sourceMode === "players"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Choose players
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => setSourceMode("matches")}
            className={`rounded px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              sourceMode === "matches"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            From parent matches
          </button>
        </div>

        {sourceMode === "matches" ? (
          <div className="space-y-1">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Participants auto-fill once all selected parent matches are revealed.
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-zinc-300 p-2 dark:border-zinc-700">
              {parentCandidates.length === 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No earlier matches available.
                </p>
              )}
              {parentCandidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={selectedParentIds.has(candidate.id)}
                    onChange={() => toggleParent(candidate.id)}
                    disabled={locked}
                  />
                  Match {candidate.position}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedPlayerIds.size} selected
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-zinc-300 p-2 dark:border-zinc-700">
              {selectablePlayers.length === 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">No players available.</p>
              )}
              {selectablePlayers.map((player) => (
                <label
                  key={player.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.has(player.id)}
                    onChange={() => togglePlayer(player.id)}
                    disabled={locked}
                  />
                  {player.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          disabled={locked}
          onClick={handleSave}
          className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Save
        </button>
      </div>
    </div>
  );
}
