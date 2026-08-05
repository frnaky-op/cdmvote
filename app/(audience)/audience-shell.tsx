"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useEventStream } from "@/lib/hooks/useEventStream";
import type { CurrentMatchStatus } from "@/lib/match-state";
import type { RealtimeEvent } from "@/lib/redis";
import ScalableLayout from "./scalableLayout";
import styles from "./audience-shell.module.css";

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

  return (
    <ScalableLayout baseWidth={1080} baseHeight={1920}>
      {!match ? (
        <WaitingScreen />
      ) : (
        <VotingScreen
          position={match.position}
          participants={participants}
          hasVoted={hasVoted}
          votedPlayerId={votedPlayerId}
          voting={voting}
          voteError={voteError}
          onVote={handleVote}
        />
      )}
    </ScalableLayout>
  );
}

function WaitingScreen() {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center bg-cover bg-center px-6 text-center"
      style={{ backgroundImage: "url(/bg.png)" }}
    >
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
      className="relative flex h-full w-full flex-col overflow-hidden bg-cover bg-center pb-8"
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

      {/* <players section> */}
      <div className="relative mt-50">
        <div className={`relative bg-center p-0 ${styles.playersSection}`}>
          {hasVoted && votedPlayer ? (
            <VotedCard participant={votedPlayer} />
          ) : (
            <div className={styles.cardsRow}>
              <div className={styles.cardsContainer}>
                {participants.map((participant) => (
                  <PlayerCard
                    key={participant.id}
                    participant={participant}
                    disabled={voting}
                    onVote={() => onVote(participant.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* </players section> */}


      {voteError && (
        <p className="mt-4 px-6 text-center text-sm font-medium text-red-300">{voteError}</p>
      )}
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
      className={styles.card}
    >
      <span className={styles.cardImageWrap}>
        {participant.photoUrl ? (
          <Image
            src={participant.photoUrl}
            alt={participant.name}
            width={205}
            height={234}
            className={styles.cardImage}
          />
        ) : (
          <div className={styles.cardImageFallback}>{participant.name}</div>
        )}
      </span>
      <Image
        src="/btn-votez.png"
        alt="Votez"
        width={167}
        height={43}
        className={styles.voteButton}
      />
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
