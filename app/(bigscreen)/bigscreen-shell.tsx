"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useEventStream } from "@/lib/hooks/useEventStream";
import type { BigscreenStatus } from "@/lib/match-state";
import type { RealtimeEvent } from "@/lib/redis";

const RESULT_LABEL: Record<string, string> = {
  winner: "Champion",
  advanced: "Advances",
  eliminated: "Eliminated",
};

const REVEAL_INTERVAL_MS = 1000;

export function BigscreenShell({
  initialStatus,
  qrCodeDataUrl,
}: {
  initialStatus: BigscreenStatus;
  qrCodeDataUrl: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);

  const refetch = useCallback(async () => {
    const response = await fetch("/api/matches/bigscreen");
    if (response.ok) setStatus(await response.json());
  }, []);

  // Unattended screen — may sit for hours. onOpen re-fetches on both the
  // initial connect and every reconnect, so a dropped wifi connection can't
  // leave this frozen on stale data.
  useEventStream<RealtimeEvent>("/api/stream", {
    onOpen: refetch,
    onMessage: () => refetch(),
  });

  const { match, participants, results, totalMatches, tournamentWinner } = status;

  if (!match) {
    return tournamentWinner ? (
      <ChampionScreen winner={tournamentWinner} />
    ) : (
      <IdleScreen />
    );
  }

  if (match.state === "open") {
    return (
      <OpenScreen
        position={match.position}
        totalMatches={totalMatches}
        participants={participants}
        qrCodeDataUrl={qrCodeDataUrl}
      />
    );
  }

  if (match.state === "closed") {
    return <TallyingScreen position={match.position} participants={participants} />;
  }

  return (
    <RevealScreen
      key={match.id}
      position={match.position}
      participants={participants}
      results={results ?? []}
      isFinal={match.survivorsCount === 1}
    />
  );
}

function IdleScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950 text-center">
      <p className="text-4xl font-semibold text-zinc-100">Tournament Voting</p>
      <p className="mt-3 text-lg text-zinc-500">Waiting for the next match…</p>
    </div>
  );
}

function ChampionScreen({
  winner,
}: {
  winner: { id: string; name: string; photoUrl: string | null };
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950 text-center">
      <p className="mb-6 text-lg font-medium tracking-widest text-amber-400 uppercase">
        Champion
      </p>
      <div className="h-64 w-64 overflow-hidden rounded-full border-4 border-amber-400 bg-zinc-800">
        {winner.photoUrl && (
          <Image
            src={winner.photoUrl}
            alt={winner.name}
            width={256}
            height={256}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <p className="mt-6 text-5xl font-bold text-zinc-50">{winner.name}</p>
    </div>
  );
}

function OpenScreen({
  position,
  totalMatches,
  participants,
  qrCodeDataUrl,
}: {
  position: number;
  totalMatches: number;
  participants: { id: string; name: string; photoUrl: string | null }[];
  qrCodeDataUrl: string | null;
}) {
  return (
    <div className="relative flex flex-1 flex-col bg-zinc-950 px-10 py-10">
      <p className="mb-1 text-center text-sm font-medium tracking-widest text-zinc-500 uppercase">
        Match {position} of {totalMatches}
      </p>
      <p className="mb-8 text-center text-2xl font-medium text-zinc-100">Vote now</p>
      <ParticipantGrid participants={participants} />

      {qrCodeDataUrl && (
        <div className="fixed right-8 bottom-8 flex flex-col items-center rounded-xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI, not eligible for next/image optimization */}
          <img src={qrCodeDataUrl} alt="Scan to vote" width={160} height={160} />
          <p className="mt-1 text-xs font-medium text-zinc-900">Scan to vote</p>
        </div>
      )}
    </div>
  );
}

function TallyingScreen({
  position,
  participants,
}: {
  position: number;
  participants: { id: string; name: string; photoUrl: string | null }[];
}) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-950 px-10 py-10">
      <p className="mb-8 text-center text-2xl font-medium text-zinc-400">
        Match {position} — Tallying votes…
      </p>
      <div className="opacity-50">
        <ParticipantGrid participants={participants} />
      </div>
    </div>
  );
}

function RevealScreen({
  position,
  participants,
  results,
  isFinal,
}: {
  position: number;
  participants: { id: string; name: string; photoUrl: string | null }[];
  results: { playerId: string; result: string }[];
  isFinal: boolean;
}) {
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (results.length === 0) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setRevealedCount(count);
      if (count >= results.length) clearInterval(timer);
    }, REVEAL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [results.length]);

  const participantById = new Map(participants.map((p) => [p.id, p]));

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 px-10 py-10">
      <p className="mb-8 text-center text-2xl font-medium text-zinc-300">
        Match {position} — Results
      </p>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
        {results.map((entry, index) => {
          const participant = participantById.get(entry.playerId);
          if (!participant) return null;
          const isRevealed = index < revealedCount;
          const isChampion = isFinal && entry.result === "winner";
          const isOut = entry.result === "eliminated";

          return (
            <div
              key={entry.playerId}
              className={`overflow-hidden rounded-xl border transition-all duration-500 ${
                !isRevealed
                  ? "border-zinc-800 bg-zinc-900 opacity-0"
                  : isChampion
                    ? "scale-105 border-amber-400 bg-zinc-900 shadow-lg shadow-amber-400/20"
                    : isOut
                      ? "border-zinc-800 bg-zinc-900 opacity-40"
                      : "border-amber-400 bg-zinc-900"
              }`}
              style={{ opacity: isRevealed ? undefined : 0 }}
            >
              <div className="aspect-square w-full bg-zinc-800">
                {isRevealed && participant.photoUrl && (
                  <Image
                    src={participant.photoUrl}
                    alt={participant.name}
                    width={400}
                    height={400}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="px-3 py-3 text-center">
                <p className="text-lg font-semibold text-zinc-50">
                  {isRevealed ? participant.name : ""}
                </p>
                <p className={`text-sm ${isOut ? "text-zinc-500" : "text-amber-400"}`}>
                  {isRevealed ? RESULT_LABEL[entry.result] : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParticipantGrid({
  participants,
}: {
  participants: { id: string; name: string; photoUrl: string | null }[];
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
      {participants.map((participant) => (
        <div
          key={participant.id}
          className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
        >
          <div className="aspect-square w-full bg-zinc-800">
            {participant.photoUrl && (
              <Image
                src={participant.photoUrl}
                alt={participant.name}
                width={400}
                height={400}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <p className="px-3 py-3 text-center text-lg font-semibold text-zinc-50">
            {participant.name}
          </p>
        </div>
      ))}
    </div>
  );
}
