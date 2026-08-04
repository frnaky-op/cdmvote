import { unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

/**
 * Wipes all players, matches, participants, and votes for the tournament —
 * a clean slate for testing or a pre-event rehearsal. Leaves the Tournament
 * row and AdminUser untouched. Deletes in FK-safe order: Vote and
 * MatchParticipant (children) before Match and Player.
 */
export async function resetTournamentData(): Promise<void> {
  const tournament = await prisma.tournament.findFirst();
  if (!tournament) return;

  const players = await prisma.player.findMany({
    where: { tournamentId: tournament.id },
    select: { photoUrl: true },
  });

  await prisma.$transaction([
    prisma.vote.deleteMany({ where: { match: { tournamentId: tournament.id } } }),
    prisma.matchParticipant.deleteMany({ where: { match: { tournamentId: tournament.id } } }),
    prisma.match.deleteMany({ where: { tournamentId: tournament.id } }),
    prisma.player.deleteMany({ where: { tournamentId: tournament.id } }),
  ]);

  await Promise.all(
    players
      .filter((player) => player.photoUrl)
      .map((player) =>
        unlink(path.join(process.cwd(), "public", player.photoUrl!)).catch(() => {
          // file already missing on disk — nothing to clean up
        }),
      ),
  );
}
