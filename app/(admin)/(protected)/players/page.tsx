import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ResetTournamentButton } from "../reset-tournament-button";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  eliminated: "Eliminated",
  winner: "Winner",
};

export default async function PlayersPage() {
  const players = await prisma.player.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Players</h1>
        <Link
          href="/players/new"
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          New player
        </Link>
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No players yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {players.map((player) => (
            <li key={player.id}>
              <Link
                href={`/players/${player.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  {player.photoUrl && (
                    <Image
                      src={player.photoUrl}
                      alt={player.name}
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {player.name}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {STATUS_LABEL[player.status] ?? player.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ResetTournamentButton />
    </div>
  );
}
