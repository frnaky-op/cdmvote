"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type PlayerNodeData = {
  name: string;
  status: string;
};

export type PlayerNodeType = Node<PlayerNodeData, "player">;

const STATUS_STYLE: Record<string, string> = {
  active: "border-zinc-300 dark:border-zinc-700",
  eliminated: "border-red-300 opacity-60 dark:border-red-800",
  winner: "border-amber-400 dark:border-amber-500",
};

export function PlayerNode({ data }: NodeProps<PlayerNodeType>) {
  const style = STATUS_STYLE[data.status] ?? STATUS_STYLE.active;

  return (
    <div
      className={`flex w-36 items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 shadow-sm dark:bg-zinc-900 ${style}`}
    >
      <Handle type="source" position={Position.Right} className="!bg-zinc-400 dark:!bg-zinc-500" />
      {data.status === "winner" && <span aria-hidden>🏆</span>}
      <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
        {data.name}
      </span>
    </div>
  );
}
