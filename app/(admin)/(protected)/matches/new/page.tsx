import { prisma } from "@/lib/db";
import { MatchForm } from "../match-form";

export const dynamic = "force-dynamic";

export default async function NewMatchPage() {
  const [activePlayers, availableParentMatches, lastMatch] = await Promise.all([
    prisma.player.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // A new match's position is always after every existing match, so all
    // existing matches are valid parent candidates here.
    prisma.match.findMany({
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        state: true,
        survivorsCount: true,
        _count: { select: { participants: { where: { result: { in: ["advanced", "winner"] } } } } },
      },
    }),
    prisma.match.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    }),
  ]);

  const nextPosition = (lastMatch?.position ?? 0) + 1;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">New match</h1>
      <MatchForm
        activePlayers={activePlayers}
        availableParentMatches={availableParentMatches.map((m) => ({
          id: m.id,
          position: m.position,
          state: m.state,
          survivorsCount: m.survivorsCount,
          advancedCount: m._count.participants,
        }))}
        defaultPosition={nextPosition}
      />
    </div>
  );
}
