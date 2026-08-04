---
name: match-voting-state-machine
description: The core business logic for this tournament voting app — match state transitions (scheduled/open/closed/revealed/archived), vote casting rules, top-N tally computation, and player carry-forward between matches. Use this whenever implementing or modifying the vote-casting API, match state-transition endpoints (open/close/reveal), tally/results computation, or anything touching Match, MatchParticipant, Player, or Vote in the Prisma schema. Also use when something about "who advances", "elimination", "survivors", or tie-breaking comes up.
---

# Match voting state machine

This encodes the rules from the project's CLAUDE.md and docs/tasks.md so
they're implemented consistently rather than re-derived (or subtly
mis-derived) each time this logic gets touched.

## State machine

`scheduled → open → closed → revealed → archived`

Every transition is a manual admin action (no automatic timers in the
default build — see CLAUDE.md non-goals). Implement transitions as explicit
functions in `lib/match-state.ts`, not inline in route handlers, and make
each one validate the *current* state before transitioning — reject with a
clear error if the match isn't in the expected prior state (e.g. can't
"close" a match that's still `scheduled`).

| Transition | Guard | Side effects |
|---|---|---|
| open | state === 'scheduled' | set openedAt, publish `match_opened` |
| close | state === 'open' | set closedAt, recompute tallies from Vote table (see below), publish `match_closed` |
| reveal | state === 'closed' | compute top-N, set Player.status + MatchParticipant.result, set revealedAt, publish `match_revealed` with results payload |
| archive | state === 'revealed' | mark archived once survivors are confirmed assigned to the next match (or just as a matter of course after reveal — pick one, but don't leave "archived" unreachable) |

## Vote casting rules

- Only accept votes when `match.state === 'open'`. Reject otherwise (closed,
  scheduled, revealed — all invalid).
- Enforce one vote per `(matchId, voterId)` **at the database level** via the
  unique constraint already in the schema — don't rely on an application-level
  check alone (race conditions: two rapid requests from the same voter can
  both pass an app-level "have they voted?" check before either writes).
- Handle the unique-constraint violation gracefully: catch it and return a
  normal "already voted" response, not a 500. This is the expected path when
  someone double-taps or has two tabs open, not an error condition.
- Update the tally atomically with the vote insert: wrap the `Vote` create
  and the `MatchParticipant.voteCount` increment in a single
  `prisma.$transaction`. This keeps live admin tallies (read from
  `voteCount`) correct without a separate aggregation query on every read.
- On `close`, recompute tallies from a `COUNT(*) GROUP BY playerId` over the
  `Vote` table as the source of truth, and reconcile against the
  denormalized `voteCount` — the denormalized value is a fast-path for live
  display, not the ground truth. This catches any drift (e.g. from a bug or
  a manual DB fix) before it affects who advances.

## Top-N / reveal computation

- Sort this match's `MatchParticipant` rows by (reconciled) vote count,
  descending.
- Top `survivorsCount` participants get `result = 'advanced'` (or `'winner'`
  if this is the final match — check `match.position === 5`, or more
  robustly, `survivorsCount === 1`).
- The rest get `result = 'eliminated'`.
- Update the corresponding `Player.status` to match: `active` stays `active`
  for advanced players (they're eligible for the next match's participant
  picker), `eliminated` for eliminated players, `winner` for the final
  match's single survivor.

## Ties at the cutoff line

Per the project's confirmed design: **do not auto-resolve ties.** If two or
more participants are tied for the last advancing spot, the reveal step
should surface this clearly (e.g. return a "tie detected, N/A automatically
resolved" state or flag) and require a manual admin action rather than
silently picking one via row order or player ID. This isn't built yet as a
full UI (that's Phase 5 in tasks.md) — but even in Phase 2's manual-only
flow, the reveal logic should *detect* and report a tie rather than
resolving it arbitrarily, since arbitrary resolution now becomes a silent bug
later.

## Player carry-forward

The mechanism connecting one match to the next: a `Player` with
`status === 'active'` is eligible to be added as a `MatchParticipant` on the
next match. There's no separate "eligible pool" table — it's derived
directly from `Player.status`, which is exactly why the reveal step updating
`Player.status` correctly (not just `MatchParticipant.result`) matters. If
you only update `MatchParticipant.result` and forget `Player.status`, the
admin's participant picker for the next match will be wrong.

## Idempotency

`close` and `reveal` should be safe against accidental double-invocation
(e.g. a double-click, or a retried request after a network blip) — check the
guard condition (current state) before applying side effects, and if the
match is already past the target state, return the existing result rather
than recomputing/re-publishing. Re-publishing a `match_revealed` event for a
match that was already revealed could re-trigger the bigscreen's reveal
animation, which is a visible bug in front of a live audience — worth
guarding against explicitly.
