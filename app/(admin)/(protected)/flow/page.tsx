import { prisma } from "@/lib/db";
import { FlowBoard } from "./flow-board";

export const dynamic = "force-dynamic";

export default async function FlowPage() {
  const [matches, players] = await Promise.all([
    prisma.match.findMany({
      orderBy: { position: "asc" },
      include: {
        participants: { select: { playerId: true, result: true } },
        parentLinks: { select: { parentMatchId: true } },
      },
    }),
    prisma.player.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    }),
  ]);

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      <div className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Tournament flow</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Drag between matches to link a parent match. Edit position, survivors, and participants
          directly on each match card.
        </p>
      </div>
      <div className="relative flex-1">
        <FlowBoard initialMatches={matches} initialPlayers={players} />
      </div>
    </div>
  );
}
