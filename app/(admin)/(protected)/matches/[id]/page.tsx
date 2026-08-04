import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { MatchForm } from "../match-form";

export default async function EditMatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [match, activePlayers] = await Promise.all([
    prisma.match.findUnique({
      where: { id },
      include: { participants: true },
    }),
    prisma.player.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!match) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Edit match {match.position}
      </h1>
      <MatchForm
        activePlayers={activePlayers}
        match={{
          id: match.id,
          position: match.position,
          survivorsCount: match.survivorsCount,
          state: match.state,
          scheduledStart: match.scheduledStart?.toISOString() ?? null,
          scheduledEnd: match.scheduledEnd?.toISOString() ?? null,
          participantPlayerIds: match.participants.map((p) => p.playerId),
        }}
      />
    </div>
  );
}
