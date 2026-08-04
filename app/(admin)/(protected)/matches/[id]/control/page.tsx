import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { MatchControlShell } from "./match-control-shell";

export const dynamic = "force-dynamic";

export default async function MatchControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      participants: {
        include: { player: { select: { id: true, name: true, photoUrl: true, status: true } } },
      },
    },
  });
  if (!match) notFound();

  return <MatchControlShell initialMatch={match} />;
}
