"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useEventStream } from "@/lib/hooks/useEventStream";
import type { CurrentMatchStatus } from "@/lib/match-state";
import type { RealtimeEvent } from "@/lib/redis";

type Participant = CurrentMatchStatus["participants"][number];

const TOTAL_MATCHES = 5;

export function AudienceShell({ initialStatus }: { initialStatus: CurrentMatchStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const response = await fetch("/api/matches/current");
    if (response.ok) setStatus(await response.json());
  }, []);

  useEventStream<RealtimeEvent>("/api/stream", {
    onOpen: refetch,
    onMessage: () => refetch(),
  });

  const handleVote = useCallback(
    async (playerId: string) => {
      if (!status.match || status.hasVoted || voting) return;

      setVoting(true);
      setVoteError(null);

      try {
        const response = await fetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: status.match.id, playerId }),
        });

        if (response.status === 409) {
          // Match closed underneath us — resync to whatever state is current.
          await refetch();
          return;
        }
        if (!response.ok) {
          setVoteError("Vote failed — please try again.");
          return;
        }

        const data: { alreadyVoted: boolean; votedPlayerId: string } = await response.json();
        setStatus((prev) => ({ ...prev, hasVoted: true, votedPlayerId: data.votedPlayerId }));
      } catch {
        setVoteError("Network error — please try again.");
      } finally {
        setVoting(false);
      }
    },
    [status.match, status.hasVoted, voting, refetch],
  );

  const { match, participants, hasVoted, votedPlayerId } = status;

  if (!match) {
    return <WaitingScreen />;
  }

  return (
    <VotingScreen
      position={match.position}
      participants={participants}
      hasVoted={hasVoted}
      votedPlayerId={votedPlayerId}
      voting={voting}
      voteError={voteError}
      onVote={handleVote}
    />
  );
}

function WaitingScreen() {
  return (
    <div
      className="flex min-h-screen flex-1 flex-col items-center justify-center bg-cover bg-center px-6 text-center"
      style={{ backgroundImage: "url(/bg.png)" }}
    >
      <Image
        src="/CDM-logo.png"
        alt="La Coupe D'Humour"
        width={364}
        height={238}
        className="w-48 drop-shadow-lg"
        priority
      />
      <p className="mt-8 text-lg font-medium text-amber-100">No match is open right now</p>
      <p className="mt-1 text-sm text-amber-100/60">Check back soon.</p>
    </div>
  );
}

function VotingScreen({
  position,
  participants,
  hasVoted,
  votedPlayerId,
  voting,
  voteError,
  onVote,
}: {
  position: number;
  participants: Participant[];
  hasVoted: boolean;
  votedPlayerId: string | null;
  voting: boolean;
  voteError: string | null;
  onVote: (playerId: string) => void;
}) {
  const votedPlayer = participants.find((participant) => participant.id === votedPlayerId) ?? null;

  return (
    <div
      className="relative flex min-h-screen flex-1 flex-col bg-cover bg-center pb-8"
      style={{ backgroundImage: "url(/bg.png)" }}
    >
      <Image
        src="/tete-de-page.png"
        alt=""
        width={1080}
        height={184}
        className="w-full"
        priority
      />

      <div className="mt-4 flex flex-col items-center px-4">
        <Image src="/Khfifa.png" alt="Khfifa présente" width={616} height={336} className="w-40" />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 px-4">
        <Image
          src="/CDM-logo.png"
          alt="La Coupe D'Humour"
          width={364}
          height={238}
          className="w-28 shrink-0"
        />
        <div className="flex flex-col items-end text-right">
          <p
            className="text-3xl leading-none font-black text-white italic"
            style={{ WebkitTextStroke: "1px #1a1400" }}
          >
            <span className="text-amber-400">#</span>MATCH{position}
          </p>
          <p className="mt-1 rounded bg-amber-400 px-2 py-0.5 text-[11px] font-bold tracking-wide text-black uppercase">
            {TOTAL_MATCHES} matchs · 1 seul gagnant !
          </p>
        </div>
      </div>

      <div className="relative mt-6 px-4">
        <div
          className="relative overflow-hidden rounded-4xl border border-amber-500/40 bg-cover bg-center p-3 shadow-2xl"
          style={{ backgroundImage: "url(/cadre.png)" }}
        >
          {hasVoted && votedPlayer ? (
            <VotedCard participant={votedPlayer} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {participants.map((participant) => (
                <PlayerCard
                  key={participant.id}
                  participant={participant}
                  disabled={voting}
                  onVote={() => onVote(participant.id)}
                />
              ))}
            </div>
          )}
        </div>

        <Image
          src="/Trophy.png"
          alt=""
          width={212}
          height={441}
          className="pointer-events-none absolute bottom-0 left-1 w-16 drop-shadow-xl sm:w-20"
        />
      </div>

      {voteError && (
        <p className="mt-4 px-6 text-center text-sm font-medium text-red-300">{voteError}</p>
      )}

      <div className="mt-10 px-4">
        <Image src="/sponsors.png" alt="Sponsors" width={984} height={160} className="w-full" />
      </div>
    </div>
  );
}

function PlayerCard({
  participant,
  disabled,
  onVote,
}: {
  participant: Participant;
  disabled: boolean;
  onVote: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onVote}
      disabled={disabled || !participant.photoUrl}
      className="group relative w-full overflow-hidden rounded-2xl outline-none transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {participant.photoUrl ? (
        <Image
          src={participant.photoUrl}
          alt={participant.name}
          width={205}
          height={234}
          className="h-auto w-full"
        />
      ) : (
        <div className="flex aspect-205/234 w-full items-center justify-center rounded-2xl bg-black/30 px-2 text-center text-xs text-amber-100">
          {participant.name}
        </div>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-0 ring-amber-400 transition group-active:ring-4" />
    </button>
  );
}

function VotedCard({ participant }: { participant: Participant }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      {participant.photoUrl && (
        <Image
          src={participant.photoUrl}
          alt={participant.name}
          width={205}
          height={234}
          className="w-40 drop-shadow-2xl"
        />
      )}
      <p className="mt-4 text-lg font-bold text-amber-300 uppercase">Vote enregistré !</p>
      <p className="mt-1 text-sm text-amber-100/80">
        Merci d&apos;avoir voté pour {participant.name}.
      </p>
    </div>
  );
}
