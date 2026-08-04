import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PlayerForm } from "../player-form";

export default async function EditPlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();

  const participantCount = await prisma.matchParticipant.count({ where: { playerId: id } });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Edit player</h1>
      <PlayerForm player={player} canDelete={participantCount === 0} />
    </div>
  );
}
