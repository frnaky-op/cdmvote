import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { publicChannel, redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function GET(request: NextRequest) {
  const tournament = await prisma.tournament.findFirst();
  if (!tournament) {
    return new Response("No tournament configured", { status: 500 });
  }

  const encoder = new TextEncoder();
  const subscriber = redis.duplicate();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller already closed (client disconnected mid-enqueue) — ignore
        }
      };

      subscriber.on("message", (_channel, message) => {
        send(`data: ${message}\n\n`);
      });
      await subscriber.subscribe(publicChannel(tournament.id));

      const heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_INTERVAL_MS);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        await subscriber.unsubscribe();
        await subscriber.quit();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
