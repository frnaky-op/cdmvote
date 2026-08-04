import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  revealed: "Revealed",
  archived: "Archived",
};

export default async function MatchesPage() {
  const matches = await prisma.match.findMany({
    orderBy: { position: "asc" },
    include: { _count: { select: { participants: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Matches</h1>
        <Link
          href="/matches/new"
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          New match
        </Link>
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No matches yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {matches.map((match) => (
            <li key={match.id} className="flex items-center gap-4 px-4 py-3">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Match {match.position}
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {STATE_LABEL[match.state] ?? match.state}
              </span>
              <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
                {match._count.participants} participants · top {match.survivorsCount} advance
              </span>
              <Link
                href={`/matches/${match.id}/control`}
                className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
              >
                Control
              </Link>
              <Link
                href={`/matches/${match.id}`}
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
