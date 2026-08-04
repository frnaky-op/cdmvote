"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type MatchNodeData = {
  matchId: string;
  position: number;
  state: string;
  survivorsCount: number;
  participantCount: number;
  sourceMode: "players" | "matches";
  locked: boolean;
  onSurvivorsCountChange: (matchId: string, value: number) => void;
  onOpenEditor: (matchId: string) => void;
};

export type MatchNodeType = Node<MatchNodeData, "match">;

const STATE_STYLE: Record<string, string> = {
  scheduled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  closed: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  revealed: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
  archived: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export function MatchNode({ data }: NodeProps<MatchNodeType>) {
  const stateStyle = STATE_STYLE[data.state] ?? STATE_STYLE.scheduled;

  return (
    <div className="w-56 rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <Handle type="target" position={Position.Left} className="!bg-zinc-400 dark:!bg-zinc-500" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-400 dark:!bg-zinc-500" />

      <div className="flex items-center justify-between rounded-t-xl border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Match {data.position}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stateStyle}`}>
          {data.state}
        </span>
      </div>

      <div className="space-y-2 px-3 py-3">
        <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
          <span>Participants</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-50">{data.participantCount}</span>
        </div>

        <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <span>Survivors</span>
          <input
            type="number"
            min={1}
            disabled={data.locked}
            value={data.survivorsCount}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1) {
                data.onSurvivorsCountChange(data.matchId, value);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right text-xs text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:disabled:bg-zinc-900"
          />
        </label>

        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Source:{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {data.sourceMode === "matches" ? "Parent matches" : "Manual players"}
          </span>
        </div>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => data.onOpenEditor(data.matchId)}
          className="w-full rounded bg-zinc-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Edit participants
        </button>
      </div>
    </div>
  );
}
