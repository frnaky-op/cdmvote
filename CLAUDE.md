# Live Tournament Voting App — Project Guide

## What this is
A live-event voting platform for a 16-player, 5-match elimination tournament.
Audience votes for favorite players each match; top-N vote-getters advance;
survivors feed into the next match; final match produces one winner.

Three views over one app, one Postgres DB, one Redis pub/sub channel set:
- **Audience** — public, mobile-first, vote on the currently open match
- **Bigscreen** — public URL, unattended full-screen display for a TV/projector,
  shows current match players live and plays a reveal animation on close
- **Admin** — authed, CRUD players/matches, control match state, view live tallies

## Tournament math (fixed, do not re-derive)
- Match 1: 8 players → top 5 advance
- Match 2: 8 players → top 5 advance (5+5 = 10 feeds Match 3)
- Match 3: 10 players → top 6 advance
- Match 4: 6 players → top 4 advance
- Match 5 (final): 4 players → top 1 = winner

`survivorsCount` is stored per-match, not hardcoded in logic. The rule is always
"top N by vote count." Ties at the cutoff line are resolved manually by admin —
do not build automatic tie-breaking.

## Tech stack (locked — do not swap or add alternatives)
- Next.js (App Router), single app, route groups for the three views
- Prisma + Postgres
- Redis (pub/sub for live updates, nothing else — no caching layer, no queues)
- SSE (`text/event-stream`) for realtime push. **Not** WebSockets, **not**
  socket.io, **not** a managed realtime service. One-directional server→client
  is sufficient; votes are normal POST requests.
- Cookie-based anonymous voter ID (no login, no OTP, no per-seat tokens) —
  loose anti-abuse is an accepted tradeoff, not a bug to fix later
- Docker Compose: app container + postgres + redis (+ reverse proxy only if
  needed for SSE buffering — skip otherwise)
- Single admin user via session cookie/JWT — no roles, no permission tiers

## Explicit non-goals (do not build these unless the user asks again)
- No user accounts / registration for audience
- No live vote-count display to audience or bigscreen — confirmed both stay
  blind during voting (suspense by design). Admin *does* get live counts —
  that's in scope, see `tally_update` event above — but it's admin-only
- No multi-tournament roster reuse (Player belongs to one Tournament)
- No automatic tie-breaking
- No horizontal scaling setup (multi-instance Redis adapter, sticky sessions)
  — this is a single-instance Docker deploy for a live event
- No analytics, no notifications, no email, no payment, no social sharing
- No WebSocket fallback/upgrade path — SSE only
- No admin permission roles — one admin login is enough
- No automated scheduled-time enforcement in Phase 1 (manual open/close first;
  scheduled auto-close is a later phase, only build if explicitly requested)

If a task seems to need one of the above, stop and ask rather than adding it.

## Folder structure
```
app/
  (audience)/          public voting UI
  (bigscreen)/          full-screen display
  (admin)/               CRUD + controls, authed
  api/
    players/            CRUD
    matches/            CRUD + state transitions (open/close/reveal)
    votes/               cast vote
    stream/              SSE endpoint, subscribes to Redis
    auth/                 admin login
lib/
  db.ts                Prisma client singleton
  redis.ts              publish/subscribe helpers
  voter.ts               anonymous voter-id cookie helpers
  match-state.ts    state transition + tally logic
prisma/
  schema.prisma
docs/
  tasks.md               phased build checklist — work through in order
  frontend-audience.md
  frontend-bigscreen.md
  frontend-admin.md
  deployment.md
Dockerfile                production build (requires output: 'standalone')
docker-compose.yml         local dev
docker-compose.prod.yml    server, pulls image from GHCR
Caddyfile                   reverse proxy + auto TLS
.github/workflows/deploy.yml  build → push GHCR → deploy over SSH
.claude/skills/                project-specific skills — Claude Code should
  consult these automatically when working in their domain:
  - nextjs-sse-redis            SSE route handlers, Redis pub/sub, reconnects
  - match-voting-state-machine  vote casting, tally, top-N, ties, carry-forward
  - prisma-postgres-workflow    migrations, seeding, transactions, Alpine gotcha
  - frontend-realtime-state-machine   EventSource hook, screen state, vote lock
```

## Match state machine
`scheduled → open → closed → revealed → archived`

- **scheduled**: created, players assigned, not visible to audience as active
- **open**: audience can vote; bigscreen shows live player cards
- **closed**: admin manually ends voting; no more votes accepted; tally computed
- **revealed**: admin triggers reveal; bigscreen plays winner/survivor animation;
  Player.status and MatchParticipant.result updated
- **archived**: done; survivors available as participants for the next match

All transitions are manual admin actions in the first build. Every transition
publishes an event on the Redis channel for that tournament/match.

## Realtime event types (keep this list minimal)
- `match_opened` — `{ matchId }`
- `match_closed` — `{ matchId }`
- `match_revealed` — `{ matchId, results: [{playerId, result}] }`
- `tally_update` — `{ matchId, tallies: [{playerId, voteCount}] }`. **Admin
  only.** Bigscreen and audience stay blind during voting (confirmed choice)
  — do not render this event's data anywhere except the admin match-control
  screen. Give admin its own SSE subscription separate from the public
  bigscreen/audience one so tallies never reach a public client.

## Conventions
- Server-side vote validation: unique constraint on (matchId, voterId) — enforce
  at the DB level, not just app level
- Bigscreen must re-fetch current match state via REST on connect/reconnect,
  never trust SSE stream continuity alone
- Keep API routes thin; state-transition and tally logic lives in
  `lib/match-state.ts`, not inline in route handlers
- Prisma is the only DB access layer — no raw SQL unless a specific query
  genuinely requires it

## Working process
Follow `docs/tasks.md` in order, phase by phase. Do not jump ahead to realtime
(Phase 3) before core CRUD and manual voting flow (Phases 1–2) work end to end.
After each phase, stop and confirm before continuing to the next.
