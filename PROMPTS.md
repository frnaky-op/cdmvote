# Session prompts

Claude Code auto-loads `CLAUDE.md` at the start of every session in this
folder, but it does **not** know what happened in a *previous* chat unless
that work is reflected in the files on disk. These prompts exist to close
that gap: each one tells Claude Code exactly which files to (re)read before
touching anything, so a brand-new chat picks up where the last one left off
instead of guessing, re-deriving decisions, or redoing work.

**This only works if tasks.md gets kept up to date.** Every prompt below
ends with an instruction to check off completed items — don't skip that
step when reviewing Claude Code's work, or the next session loses the thread.

---

## 0. First session ever — kickoff

```
Read CLAUDE.md, docs/tasks.md, and prisma/schema.prisma in full before doing
anything.

Start Phase 0 (Scaffolding) from docs/tasks.md. The Docker and CI/CD files
listed as already done in that phase are already in the repo — don't
recreate them, just verify the app works with them (e.g. next.config.js
needs output: 'standalone' for the existing Dockerfile to work).

Work through Phase 0's checklist in order. After each item, check it off in
docs/tasks.md. Stop and tell me when Phase 0 is complete — don't continue
into Phase 1 without me confirming.
```

## 1. Any new session, mid-project — universal resume prompt

Use this as the opening message of every session after the first one,
before asking for anything specific:

```
Before doing anything else: read CLAUDE.md, docs/tasks.md, and check which
items are already checked off vs still open. Also skim any docs/frontend-*.md
files relevant to what I'm about to ask, and check .claude/skills/ for any
skill relevant to the task.

Do not redo or second-guess anything already marked complete in tasks.md
unless I explicitly say we're revisiting it. Tell me briefly what you
understand the current state of the project to be before starting new work.
```

Then follow it with whatever specific task you want done that session (one
of the prompts below, or your own ask).

## 2. Phase 1 — Core CRUD

```
We're on Phase 1 of docs/tasks.md (Core CRUD, no realtime yet). Confirm
Phase 0 is fully checked off first — if anything's incomplete or looks
wrong, flag it before proceeding rather than building on top of it.

Implement Phase 1's checklist in order: Player CRUD, Tournament + Match CRUD,
and the read-only audience current-match view. Reference
docs/frontend-admin.md for how the admin CRUD screens should be structured.
Use the prisma-postgres-workflow skill for any migration/seeding work.

Check off each item in docs/tasks.md as it's done. Stop before Phase 2 for
my confirmation.
```

## 3. Phase 2 — Voting flow

```
We're on Phase 2 of docs/tasks.md (voting flow). Confirm Phase 1 is checked
off first.

Implement voter identity (anonymous cookie), the vote-casting API, and the
manual state transitions (open/close/reveal) on matches. Use the
match-voting-state-machine skill for the transition guards, tally logic, and
tie-detection rules — follow it exactly rather than improvising the
elimination logic, it encodes decisions already made.

Once built, walk through a manual end-to-end test of one full match and
report the result to me before checking off the "manual end-to-end test"
item.

Check off items in docs/tasks.md as completed. Stop before Phase 3.
```

## 4. Phase 3 — Realtime

```
We're on Phase 3 of docs/tasks.md (realtime). Confirm Phase 2 is checked off
first.

Implement the Redis publish calls on each state transition and on vote cast,
and the two separate SSE endpoints (public and admin) per the
nextjs-sse-redis skill — read that skill fully before starting, the
two-channel split and the reconnect/heartbeat/cleanup requirements are not
optional details.

Wire the admin match-control screen and bigscreen to consume their
respective streams using the frontend-realtime-state-machine skill's
useEventStream hook pattern.

Check off items in docs/tasks.md as completed. Stop before Phase 4.
```

## 5. Frontend — Audience app

```
Read docs/frontend-audience.md in full before starting.

Build the audience app as specified: one route, internal state machine
(splash/voting/success/waiting), the GET /api/matches/current endpoint if
it doesn't already exist, the 2-column player card grid, and the optimistic
vote-button lock described in the frontend-realtime-state-machine skill.

Don't add anything the spec explicitly marks as a non-goal (no animation
library, no polling loop, no vote-changing UI, no toast system) even if it
would be a reasonable-seeming addition — those were deliberate scope
decisions.

Show me the voting screen and success screen once built before moving on.
```

## 6. Frontend — Bigscreen app

```
Read docs/frontend-bigscreen.md in full before starting.

Build the bigscreen app: the idle/open/tallying/reveal state machine, the QR
code (server-side generated, no external API call — see the deployment doc
for why), and the reveal animation using the frontend-realtime-state-machine
skill's patterns. Remember bigscreen stays blind on vote counts — don't show
any numbers during the open state, and don't build any interactive elements,
this screen is unattended.

Handle the tournament-complete variant of the idle state (shows the winner)
as described in the spec, not as an afterthought.

Show me the reveal animation flow once built before moving on.
```

## 7. Frontend — Admin app

```
Read docs/frontend-admin.md in full before starting.

Build out the admin screens per the spec: Dashboard, Players, Matches, and
Match Control. Match Control needs the live vote-count feed via the admin
SSE stream (nextjs-sse-redis skill) and should only ever show one primary
action button at a time based on match state, not all three
open/close/reveal buttons with some disabled.

Don't build the manual-override / force-transition / tie-break UI — that's
explicitly Phase 5, out of scope unless I ask for it separately.

Show me the Match Control screen mid-match (open state) once built.
```

## 8. Deploy check

```
Read docs/deployment.md in full.

Before I push to main for the first real deploy, review docker-compose.prod.yml
and Caddyfile and tell me exactly which placeholder values I still need to
fill in (domain, image path) — don't assume they're already correct, check
the actual file contents.
```

## Tips for keeping context across sessions

- If a session made a decision that isn't reflected in CLAUDE.md or the
  relevant doc (e.g. you asked it to change something mid-session), update
  the doc before ending that session — otherwise the next session won't
  know about it and may revert or contradict it.
- If something in tasks.md turns out to be wrong or needs to change, edit
  tasks.md directly rather than just telling Claude Code verbally in a
  session that'll be forgotten.
- When in doubt, start a session with the universal resume prompt (#1) even
  if you think you remember the state yourself — it costs one read and
  avoids a mismatch between what you remember and what's actually on disk.
