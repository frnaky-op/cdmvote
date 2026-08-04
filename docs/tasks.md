# Build tasks — work in order, one phase at a time

Stop and confirm with the user after each phase before starting the next.
Do not pull tasks forward from later phases "while you're in there."

## Phase 0 — Scaffolding
- [x] `create-next-app` (App Router, TypeScript)
- [x] Docker Compose: app + postgres + redis services
- [x] Confirm hot-reload works inside the app container
- [x] Install Prisma, connect to Postgres, run initial migration from
      `prisma/schema.prisma` (already written — don't redesign it)
- [x] Single admin user: seed one AdminUser, basic login route + session cookie

## Phase 1 — Core CRUD (no realtime yet)
- [x] Admin: Player CRUD (name, photo upload, bio) — decide photo storage
      (local volume is fine for local dev; don't build S3 integration unless asked)
- [x] Admin: Tournament + Match CRUD (create match, assign players from active
      pool, set survivorsCount, set position)
- [x] Audience: read-only page showing the current match's players
      (hardcode "current match" lookup via state=open query, no live push yet)
- [x] API: `GET /api/matches/current` — returns the open match (or null) plus,
      using the voterId cookie, whether this voter has already voted in it and
      for whom. This is what the audience app uses to decide which screen to
      show on load/reload (voting vs success vs waiting) — see
      `docs/frontend-audience.md`

## Phase 2 — Voting flow
- [x] Voter identity: issue anonymous cookie on first visit if none exists
- [x] Vote API: cast vote, enforce (matchId, voterId) uniqueness at DB level,
      reject votes on non-open matches
- [x] Admin: manual state transitions — open match, close match, reveal
      (reveal computes top-N by voteCount, updates Player.status and
      MatchParticipant.result)
- [x] Manual end-to-end test: run one full match by hand, confirm survivors
      correctly populate as available participants for the next match

## Phase 3 — Realtime
- [x] Redis publish on each state transition (match_opened, match_closed,
      match_revealed) and on each vote (tally_update)
- [x] Two SSE endpoints: a public one (match_opened/closed/revealed only, for
      audience + bigscreen) and an admin one (adds tally_update) — keep
      tallies out of the public stream entirely, don't just filter client-side
- [x] Admin match-control screen subscribes to admin SSE, shows live counts
- [x] Bigscreen subscribes to public SSE (state changes only, stays blind
      on counts per confirmed design)
- [x] Audience page auto-detects current open match via the public stream
      instead of a manual link

## Phase 4 — Bigscreen polish
- [x] Bigscreen live view of open match's player cards (no counts)
- [x] QR code on bigscreen, visible whenever a match is open, linking to the
      audience voting URL — use a small server-side QR generation library
      (e.g. `qrcode` npm package); do not call an external QR image API
      (venue network may not have reliable outbound internet)
- [x] Reveal animation triggered by match_revealed event
- [x] Reconnect handling: on SSE reconnect, re-fetch current state via REST,
      don't trust stream continuity

## Phase 5 — Admin power features (only if requested — not default scope)
- [x] Manual override controls: force-close, reopen, manual tie-break
- [ ] Scheduled start/end time automation (deliberately deferred — needs its
      own background-scheduler pass, e.g. a Next.js instrumentation.ts hook;
      not built this round by explicit choice)

## Phase 6 — Hardening & deploy (only if requested — not default scope)
- [ ] Basic per-IP soft-flagging on vote endpoint (visibility only, no blocking)
- [ ] Empty/error states across all three views
- [ ] Production Docker build + env config

---

**Definition of done for a local MVP demo**: Phases 0–4 complete. Everything
past that is explicitly opt-in — ask before starting Phase 5 or 6.
