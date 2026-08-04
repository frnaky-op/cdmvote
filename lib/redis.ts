import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

// One shared client for publishing (votes, admin transitions call this).
// SSE route handlers create their own duplicated subscriber client per
// connection — see nextjs-sse-redis skill for why they can't share this one.
export const redis = globalForRedis.redis ?? new Redis(process.env.REDIS_URL!);

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

export function publicChannel(tournamentId: string) {
  return `tournament:${tournamentId}:public`;
}

export function adminChannel(tournamentId: string) {
  return `tournament:${tournamentId}:admin`;
}

export type RealtimeEvent =
  | { type: "match_opened"; matchId: string }
  | { type: "match_closed"; matchId: string }
  | {
      type: "match_revealed";
      matchId: string;
      results: { playerId: string; result: string }[];
    }
  | {
      type: "tally_update";
      matchId: string;
      tallies: { playerId: string; voteCount: number }[];
    };

/** State-transition events go to both streams — bigscreen needs them too. */
export async function publishToPublic(tournamentId: string, event: RealtimeEvent) {
  await redis.publish(publicChannel(tournamentId), JSON.stringify(event));
}

/** tally_update is admin-only — never publish it to the public channel. */
export async function publishToAdmin(tournamentId: string, event: RealtimeEvent) {
  await redis.publish(adminChannel(tournamentId), JSON.stringify(event));
}
