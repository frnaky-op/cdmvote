---
name: nextjs-sse-redis
description: Patterns for implementing Server-Sent Events (SSE) endpoints in a Next.js App Router route handler backed by Redis pub/sub — the realtime mechanism this tournament voting project uses for match_opened/closed/revealed and tally_update events. Use this whenever building or debugging /api/stream routes, anything under lib/redis.ts, the admin live-tally feed, bigscreen live updates, or any task involving "SSE", "server-sent events", "realtime", "live updates", "push", or "EventSource" in this project. Also use when a stream seems to hang, buffer, drop events, or not reconnect properly.
---

# SSE + Redis realtime (Next.js App Router)

This project uses SSE, not WebSockets — one-directional server→client is
enough because all client-initiated actions (votes, admin transitions) go
through normal POST endpoints. Don't reach for socket.io or a WS server;
that's a locked decision, see the project's CLAUDE.md.

## Two separate streams, not one filtered stream

Per the project spec: a **public** stream (match_opened, match_closed,
match_revealed) for audience + bigscreen, and an **admin** stream (adds
tally_update) for the admin match-control screen. Tallies must never reach a
public client — implement this as two separate route handlers /
Redis channels, not one stream with client-side filtering. Filtering
client-side still ships the data to the browser; that defeats the point.

Suggested channel naming: `tournament:{id}:public` and `tournament:{id}:admin`.
Publish state-transition events to *both* channels (bigscreen needs them
too); publish `tally_update` only to the admin channel.

## Route handler shape

Key requirements for the route handler that serves SSE:

- Force dynamic, disable caching — this is a live stream, not a cacheable
  response: `export const dynamic = 'force-dynamic'`
- Use the Node runtime, not edge — you need a persistent Redis subscriber
  connection per request, which edge runtimes don't support well:
  `export const runtime = 'nodejs'`
- Response headers: `Content-Type: text/event-stream`,
  `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`
- Build the body as a `ReadableStream`. Inside `start(controller)`:
  1. Subscribe to the relevant Redis channel
  2. On each message, `controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'))`
  3. Send a heartbeat comment (`: heartbeat\n\n`) every ~20s — some proxies
     and browsers will silently kill an idle connection with no bytes
     flowing, even one that's technically still open
- **Cleanup is not optional.** Listen for client disconnect via
  `request.signal.addEventListener('abort', () => { /* unsubscribe, close */ })`.
  Without this, every dropped connection (every phone that locks its screen,
  every bigscreen browser refresh) leaks a Redis subscription. At a live
  event with dozens/hundreds of connecting devices this will exhaust
  connections within the event if not handled.

## Redis client management

Don't create a new Redis connection per HTTP request casually — but for SSE
specifically, each open connection *does* need its own subscriber client
(Redis pub/sub subscribers can't share a connection with regular
command-issuing clients once subscribed). Pattern:
- One shared Redis client (`lib/redis.ts`) for publishing (votes, admin
  actions call this)
- A **new** subscriber client instance created per SSE connection, duplicated
  from the shared client (ioredis: `redis.duplicate()`), subscribed, and
  explicitly `.unsubscribe()` + `.quit()` on disconnect

## Client side

Use the native `EventSource` API, not a library — this project's needs
(receive JSON events, auto-reconnect) don't justify a dependency.

Critical pattern, don't skip this: **EventSource auto-reconnects, but a
reconnect does not replay missed events.** Any client that was disconnected
for even a few seconds may have missed a state transition. So:
- On `EventSource.onopen` (fires on initial connect *and* every reconnect),
  always re-fetch current state via a REST call (e.g.
  `GET /api/matches/current` or an admin equivalent) rather than trusting
  that the stream picks up where it left off
- This is explicitly called out in both `docs/frontend-bigscreen.md` and
  `docs/frontend-audience.md` — implement it, it's not optional polish

## Common failure modes to check if something's not working

- **Events not arriving at all**: reverse proxy buffering. This project's
  Caddyfile already sets `flush_interval -1` for this reason — if running
  outside that setup (e.g. a different proxy locally), check for equivalent
  buffering config.
- **Connection silently dies after ~30-60s of inactivity**: missing
  heartbeat. Add the `: heartbeat` comment ping.
- **Admin sees tallies but so does audience (or vice versa)**: check you're
  actually using two channels/routes, not one channel with an `if (isAdmin)`
  render check on the client — that's a data leak, not a fix.
- **Redis connection count climbing over time**: missing abort-handler
  cleanup on the route handler.
