# La Coupe d'Humour — Match Voting App (this directory)

## What this actually is

A small, self-contained Express + SQLite app that serves **one match's**
voting page, records votes, and gives an admin a dashboard to run the
contest (open/close voting, manage candidates, generate QR ballots). No
build step, no framework on the frontend — `public/index.html` and
`admin/index.html` are plain HTML/CSS/vanilla JS.

**Read `README.md` first** — it is the primary, actively-maintained
documentation (API reference, admin dashboard walkthrough, VPS deployment
steps, QR-token system, cache-busting, backup/reset). This file only adds
what a coding session needs that the README doesn't cover: architecture
orientation, conventions, and known drift.

## ⚠️ This is not the app described by the root CLAUDE.md

`c:\laragon\www\cdmvote\CLAUDE.md` (repo root) describes a different,
larger system: Next.js App Router, Prisma + Postgres, Redis pub/sub, SSE,
a multi-match elimination bracket with survivor carry-forward, JWT admin
sessions, Docker Compose. **None of that applies to this directory.** This
app is:

| Root CLAUDE.md spec        | This app (`server.js`)              |
|-----------------------------|--------------------------------------|
| Next.js App Router          | Plain Express                        |
| Prisma + Postgres           | `better-sqlite3` (single file DB)    |
| Redis pub/sub + SSE         | None — client polls REST once on load |
| Multi-match bracket, survivors | One match per deployment (redeploy + reset DB for the next) |
| JWT admin session           | HTTP Basic Auth                      |
| Docker Compose              | Bare `node server.js` + systemd + Nginx |

Treat the root CLAUDE.md as describing a separate, aspirational system —
do not import its conventions (Prisma models, Redis events, SSE patterns,
etc.) into this directory. If a task here seems to call for something from
that spec (e.g. "add live tallies to the audience view"), stop and confirm
with the user rather than assuming the two are meant to converge.

## Architecture at a glance

- **One process, one file for logic**: `server.js` holds the schema, all
  in-memory state, and every route. It's deliberately not split into
  modules/routers — keep it that way unless the user asks for a refactor.
- **In-memory first, disk second**: votes and QR-token usage are written to
  a `Map` synchronously on the request path (instant, safe under bursts),
  then batched to SQLite by a 2-second `setInterval` in a single
  transaction. `SIGINT`/`SIGTERM` flush before exit; only a hard crash can
  lose the last <2s. See `flushToDisk`, `pendingWrites`, `pendingTokenUpdates`.
- **Candidate list cache**: `GET /api/candidates` is served from a
  precomputed JSON string (`candidatesJsonCache`), rebuilt immediately on
  any candidate add/edit/delete/reorder, with a 24h self-expiry as a
  fallback. Don't bypass this cache when adding new candidate-reading code.
- **Vote identity**: the single-use QR token (`?t=...`, tracked in
  `tokenMeta`/`vote_tokens`) is the *sole* source of truth for "already
  voted" — `POST /api/vote` rejects with `token_required`/`invalid_token`/
  `token_already_used` if it's missing, unrecognized, or already spent, and
  the public page blocks voting UI entirely (`panel-no-token`) when the URL
  has no `?t=`. This means every voter must have come from a distributed QR
  code; there's no walk-up/link-only voting. There is deliberately **no**
  per-browser/per-device gate on top of this: the same device can
  legitimately cast several votes (e.g. a shared tablet at the door), each
  with its own token — don't reintroduce one. The `httpOnly` `voter_token`
  cookie (5-year TTL) still exists and is still written to each `votes` row,
  but purely as an audit trail (which browser cast a given vote), not as a
  gate — `voterIndex`/`pendingWrites` are keyed by `qr_token`, not by the
  cookie. (`voter_token` is intentionally no longer `UNIQUE` in the DB
  schema; `qr_token` is.)
- **Static asset cache-busting**: `/` is rendered dynamically
  (`renderIndexHtml`), not served via `express.static`, specifically so
  every asset URL in `STATIC_IMAGE_VERSION_TARGETS` gets a `?v=<mtime>`
  suffix. Candidate photos are versioned the same way via
  `candidatePhotoUrl`. If you add a new fixed image/font to `public/`, add
  its path to `STATIC_IMAGE_VERSION_TARGETS` or it won't cache-bust. The
  static-asset substitution itself (`buildVersionedTemplate`) runs **once
  at boot**, not per-request — it does synchronous file reads/stats, and
  doing that on every hit to `/` (the one route every voter loads) caused
  intermittent 502s under a burst of concurrent page loads. Only the
  `{{MATCH_NUMBER}}` placeholder is substituted per-request now (cheap,
  no I/O). If you ever need per-request behavior here again, keep the
  expensive part cached and only redo the genuinely dynamic part.
- **Admin auth**: HTTP Basic Auth with a constant-time comparison
  (`timingSafeEqualStr`) — no sessions, no JWT, one shared admin/password
  pair from `ADMIN_USER`/`ADMIN_PASSWORD` env vars.

## Key files

- `server.js` — entire backend (~940 lines): DB schema + migrations,
  in-memory state, public API, admin API, QR token generation/export.
- `public/index.html` — the voting page. Contains a `{{MATCH_NUMBER}}`
  placeholder (title + header `<script>`) filled in server-side by
  `renderIndexHtml` from the `match_number` setting — set it from
  `/admin`, not by editing this file. A direct `GET /index.html` is
  redirected to `/` so it can't bypass that substitution.
- `admin/index.html` — the admin dashboard (voting toggle, results table,
  candidate manager, QR batch manager). Talks only to `/api/admin/*`.
- `data/votes.db` (+ `-wal`/`-shm`) — the entire persistent state. Created
  automatically on first run; seeded with 8 candidates if empty.
- `public/images/candidates/` — candidate photos; managed only through
  `/admin`, never hand-edited (filenames are derived from candidate id).

## Conventions

- **One match per deployment.** Reusing this for Match 2/3/etc. means
  setting the match number from the "Numéro du match" field in `/admin` and
  wiping `data/votes.db` for a clean slate (README has both procedures) —
  this app does not model a bracket or carry survivors forward itself.
- Ties/eliminations/advancement are **not** computed here — this app only
  records votes and shows tallies in `/admin`. Any bracket logic lives
  outside this codebase (or is done manually by whoever runs the event).
- No test suite exists. Verify changes by running `npm start` and hitting
  the routes directly (curl / the browser) rather than assuming coverage.
- **Never run port-checking or port-killing commands** (`netstat`,
  `taskkill`, `lsof -i`, etc.) against this app to "test" it, and never start
  a second `node server.js` instance pointed at the real `data/votes.db` to
  poke at it. A live instance (likely on port 3000) may already be running
  against that same file, and a second process opening it concurrently risks
  corrupting or clobbering real vote/QR-token data (this has happened
  before). If you need to verify backend behavior, ask the user to test it,
  or use an isolated copy of the DB in a scratch directory — never the real
  `data/votes.db`.
- Keep `README.md` in sync with `server.js` when routes change — it has
  already drifted once (see below).

## Known drift to watch for

- `README.md`'s "Notes" section claims `GET /api/results` is a public,
  unauthenticated endpoint. That route **does not exist** in the current
  `server.js` — the only results endpoint is `GET /api/admin/results`,
  which *is* behind `requireAdminAuth`. Don't reintroduce a public results
  route without checking with the user first; update or remove that README
  line if you're touching results/auth code.
