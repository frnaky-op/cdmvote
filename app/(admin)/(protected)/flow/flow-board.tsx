"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  BackgroundVariant,
  type Connection,
  type Edge,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MatchNode, type MatchNodeType } from "./match-node";
import { PlayerNode, type PlayerNodeType } from "./player-node";
import { MatchEditorPanel, type EditableMatch } from "./match-editor-panel";

type ApiMatch = {
  id: string;
  position: number;
  state: string;
  survivorsCount: number;
  participants: { playerId: string; result: string }[];
  parentLinks: { parentMatchId: string }[];
};

type ApiPlayer = { id: string; name: string; status: string };

type MatchPatch = Partial<{
  survivorsCount: number;
  participantPlayerIds: string[];
  parentMatchIds: string[];
}>;

const nodeTypes = { match: MatchNode, player: PlayerNode };

const MATCH_COLUMN_WIDTH = 320;
const PLAYER_ROW_HEIGHT = 48;
const PLAYER_COLUMN_OFFSET = 240;

function buildLayout(
  matches: ApiMatch[],
  players: ApiPlayer[],
  onSurvivorsCountChange: (matchId: string, value: number) => void,
  onOpenEditor: (matchId: string) => void,
): { nodes: (MatchNodeType | PlayerNodeType)[]; edges: Edge[] } {
  const matchNodes: MatchNodeType[] = matches.map((match) => ({
    id: `match-${match.id}`,
    type: "match",
    position: { x: match.position * MATCH_COLUMN_WIDTH, y: 40 },
    data: {
      matchId: match.id,
      position: match.position,
      state: match.state,
      survivorsCount: match.survivorsCount,
      participantCount: match.participants.length,
      sourceMode: match.parentLinks.length > 0 ? "matches" : "players",
      locked: match.state !== "scheduled",
      onSurvivorsCountChange,
      onOpenEditor,
    },
  }));

  const matchByPlayerId = new Map<string, ApiMatch>();
  for (const match of matches) {
    for (const participant of match.participants) {
      matchByPlayerId.set(participant.playerId, match);
    }
  }

  const playersByColumn = new Map<number, ApiPlayer[]>();
  for (const player of players) {
    const match = matchByPlayerId.get(player.id);
    const column = match ? match.position : 0;
    const bucket = playersByColumn.get(column) ?? [];
    bucket.push(player);
    playersByColumn.set(column, bucket);
  }

  const playerNodes: PlayerNodeType[] = [];
  for (const [column, bucket] of playersByColumn) {
    bucket.forEach((player, index) => {
      playerNodes.push({
        id: `player-${player.id}`,
        type: "player",
        position: {
          x: column === 0 ? 0 : column * MATCH_COLUMN_WIDTH - PLAYER_COLUMN_OFFSET,
          y: PLAYER_COLUMN_OFFSET + index * PLAYER_ROW_HEIGHT,
        },
        data: { name: player.name, status: player.status },
      });
    });
  }

  const parentEdges: Edge[] = matches.flatMap((match) =>
    match.parentLinks.map((link) => ({
      id: `parent-${link.parentMatchId}-${match.id}`,
      source: `match-${link.parentMatchId}`,
      target: `match-${match.id}`,
      animated: match.state === "scheduled",
      style: { stroke: "#0ea5e9", strokeWidth: 2 },
      data: { kind: "parent-link" },
    })),
  );

  const playerEdges: Edge[] = players
    .filter((player) => matchByPlayerId.has(player.id))
    .map((player) => {
      const match = matchByPlayerId.get(player.id)!;
      return {
        id: `assign-${player.id}-${match.id}`,
        source: `player-${player.id}`,
        target: `match-${match.id}`,
        style: { stroke: "#a1a1aa", strokeWidth: 1, strokeDasharray: "4 3" },
        selectable: false,
        data: { kind: "assignment" },
      };
    });

  return {
    nodes: [...matchNodes, ...playerNodes],
    edges: [...parentEdges, ...playerEdges],
  };
}

type Props = {
  initialMatches: ApiMatch[];
  initialPlayers: ApiPlayer[];
};

export function FlowBoard({ initialMatches, initialPlayers }: Props) {
  const [matches, setMatches] = useState<ApiMatch[]>(initialMatches);
  const [players, setPlayers] = useState<ApiPlayer[]>(initialPlayers);
  const [error, setError] = useState<string | null>(null);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  // Edges removed locally (e.g. unlinking a parent) before the server
  // confirms — kept separate from the derived `edges` below so a removal
  // reads instantly instead of waiting on the refresh round-trip.
  const [locallyRemovedEdgeIds, setLocallyRemovedEdgeIds] = useState<Set<string>>(new Set());

  // Re-fetches the whole board from the server after a mutation — mutations
  // can trigger server-side side effects (lib/match-state.ts's parent-match
  // auto-fill) this client has no other way to observe, so it always
  // resyncs from the source of truth rather than reconciling optimistically.
  const refresh = useCallback(async () => {
    const response = await fetch("/api/matches/flow");
    if (!response.ok) {
      setError("Failed to refresh tournament data");
      return;
    }
    const data = await response.json();
    setMatches(data.matches);
    setPlayers(data.players);
    setLocallyRemovedEdgeIds(new Set());
  }, []);

  const applyMatchPatch = useCallback(
    async (matchId: string, patch: MatchPatch) => {
      const current = matches.find((m) => m.id === matchId);
      if (!current) return;

      const response = await fetch(`/api/matches/${matchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: current.position,
          survivorsCount: patch.survivorsCount ?? current.survivorsCount,
          participantPlayerIds:
            patch.participantPlayerIds ?? current.participants.map((p) => p.playerId),
          parentMatchIds: patch.parentMatchIds ?? current.parentLinks.map((p) => p.parentMatchId),
          scheduledStart: null,
          scheduledEnd: null,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Failed to save change");
        return;
      }

      setError(null);
      await refresh();
    },
    [matches, refresh],
  );

  const handleSurvivorsCountChange = useCallback(
    (matchId: string, value: number) => {
      applyMatchPatch(matchId, { survivorsCount: value });
    },
    [applyMatchPatch],
  );

  const handleOpenEditor = useCallback((matchId: string) => {
    setEditingMatchId(matchId);
  }, []);

  const handleEditorSave = useCallback(
    (matchId: string, patch: { participantPlayerIds: string[]; parentMatchIds: string[] }) => {
      applyMatchPatch(matchId, patch);
      setEditingMatchId(null);
    },
    [applyMatchPatch],
  );

  // Dragging an edge between two match nodes declares a parent → child link.
  const handleConnect = useCallback(
    (connection: Connection) => {
      const parentMatch = matches.find((m) => m.id === connection.source);
      const childMatch = matches.find((m) => m.id === connection.target);
      if (!parentMatch || !childMatch) return;
      if (childMatch.state !== "scheduled") {
        setError("Cannot link a match that has moved past scheduled");
        return;
      }
      if (parentMatch.position >= childMatch.position) {
        setError("A parent match must run before the match it feeds");
        return;
      }

      const nextParentIds = [
        ...new Set([...childMatch.parentLinks.map((p) => p.parentMatchId), parentMatch.id]),
      ];
      applyMatchPatch(childMatch.id, { parentMatchIds: nextParentIds, participantPlayerIds: [] });
    },
    [matches, applyMatchPatch],
  );

  const layout = useMemo(
    () => buildLayout(matches, players, handleSurvivorsCountChange, handleOpenEditor),
    [matches, players, handleSurvivorsCountChange, handleOpenEditor],
  );

  const visibleEdges = useMemo(
    () => layout.edges.filter((edge) => !locallyRemovedEdgeIds.has(edge.id)),
    [layout.edges, locallyRemovedEdgeIds],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedIds = changes
        .filter((change): change is Extract<EdgeChange, { type: "remove" }> => change.type === "remove")
        .map((change) => change.id);
      if (removedIds.length === 0) return;

      setLocallyRemovedEdgeIds((current) => new Set([...current, ...removedIds]));

      for (const id of removedIds) {
        const edge = visibleEdges.find((e) => e.id === id);
        if (!edge || edge.data?.kind !== "parent-link") continue;
        const childMatch = matches.find((m) => m.id === edge.target);
        if (!childMatch || childMatch.state !== "scheduled") continue;
        const nextParentIds = childMatch.parentLinks
          .map((p) => p.parentMatchId)
          .filter((parentMatchId) => `match-${parentMatchId}` !== edge.source);
        applyMatchPatch(childMatch.id, { parentMatchIds: nextParentIds });
      }
    },
    [visibleEdges, matches, applyMatchPatch],
  );

  const editingMatch: EditableMatch | null = useMemo(() => {
    if (!editingMatchId) return null;
    const match = matches.find((m) => m.id === editingMatchId);
    if (!match) return null;
    return {
      id: match.id,
      position: match.position,
      state: match.state,
      survivorsCount: match.survivorsCount,
      participantPlayerIds: match.participants.map((p) => p.playerId),
      parentMatchIds: match.parentLinks.map((p) => p.parentMatchId),
    };
  }, [editingMatchId, matches]);

  const parentCandidates = useMemo(() => {
    if (!editingMatch) return [];
    return matches
      .filter((m) => m.id !== editingMatch.id && m.position < editingMatch.position)
      .map((m) => ({ id: m.id, position: m.position }));
  }, [editingMatch, matches]);

  return (
    <div className="h-full w-full">
      {error && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      <ReactFlow
        nodes={layout.nodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onEdgesChange={handleEdgesChange}
        onConnect={(connection) => {
          void addEdge(connection, visibleEdges);
          handleConnect(connection);
        }}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        colorMode="system"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap pannable zoomable className="!bg-white dark:!bg-zinc-900" />
      </ReactFlow>

      {editingMatch && (
        <MatchEditorPanel
          match={editingMatch}
          allPlayers={players}
          parentCandidates={parentCandidates}
          onClose={() => setEditingMatchId(null)}
          onSave={handleEditorSave}
        />
      )}
    </div>
  );
}
