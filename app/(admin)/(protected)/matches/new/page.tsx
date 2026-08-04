import { prisma } from "@/lib/db";
import { MatchForm } from "../match-form";

export const dynamic = "force-dynamic";

export default async function NewMatchPage() {
  const activePlayers = await prisma.player.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">New match</h1>
      <MatchForm activePlayers={activePlayers} />
    </div>
  );
}
