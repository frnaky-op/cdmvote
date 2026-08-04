---
name: frontend-realtime-state-machine
description: Client-side React patterns shared across the audience, bigscreen, and admin apps in this project — the EventSource/SSE consumption hook, the reconnect-then-refetch pattern, and the screen-state-machine approach (splash/voting/success/waiting for audience; idle/open/tallying/reveal for bigscreen). Use when building or modifying any component in app/(audience), app/(bigscreen), or the admin match-control screen, or anything involving useEffect + EventSource, screen transitions, or the optimistic vote-button lock.
---

# Frontend realtime + state machine patterns

All three frontends (audience, bigscreen, admin) are built as **one route
each with an internal state machine**, not multi-page navigation flows —
this was a deliberate decision (see `docs/frontend-audience.md`,
`docs/frontend-bigscreen.md`) so reload/reconnect always lands the user on
the *correct current* screen rather than wherever they last navigated to.

## The `useEventStream` hook pattern

Build one shared hook (e.g. `lib/hooks/useEventStream.ts`) used by bigscreen
and admin (audience only needs it if it also subscribes — check the current
spec, it may resolve state purely via the initial fetch during splash):

- Wraps `EventSource`, exposes the latest parsed event and a connection
  status
- **On `onopen` (fires on both initial connect and every auto-reconnect),
  trigger a REST re-fetch of current state.** This is the single most
  important rule in this skill — see `nextjs-sse-redis` skill for why
  EventSource reconnects don't replay missed events. Don't build a version
  of this hook that only fetches once on mount.
- Clean up (`eventSource.close()`) on unmount
- Admin's hook subscribes to the admin SSE endpoint (gets tally_update
  too); bigscreen/audience subscribe to the public one. Don't reuse one
  hook instance across both — they're different endpoints (see
  `nextjs-sse-redis` skill on why the streams are split).

## Screen state as a discriminated union, not booleans

Model each app's screen state as a single discriminated union / tagged type
rather than a handful of independent booleans
(`isLoading`/`hasVoted`/`isOpen`/...). Booleans multiply into invalid
combinations (what does `isLoading=false, hasVoted=true, isOpen=false` even
mean?) — a single `state: 'splash' | 'voting' | 'success' | 'waiting'` (or
the bigscreen equivalent `'idle' | 'open' | 'tallying' | 'reveal'`) makes
invalid states unrepresentable and makes the render function a plain switch.

Resolve which state to enter from the API response
(`GET /api/matches/current`, or its bigscreen/admin equivalent) plus local
context (e.g. "has *this* voter already voted" comes from that same
endpoint using the voter cookie — see `docs/frontend-audience.md`). Don't
infer state from a combination of separately-fetched pieces of data if the
API can just tell you directly; add fields to the endpoint response instead
of reconstructing state client-side from fragments.

## Optimistic vote-button lock

On the audience voting screen, per `docs/frontend-audience.md`: tapping a
vote button must **immediately** disable all vote buttons on screen before
the POST resolves — not after. This prevents double-submits and prevents
voting for a second player while the first request is in flight. Pattern:
set a local `submitting` flag synchronously in the click handler (before the
`await`), disable all `PlayerCard` vote buttons off that flag, then branch on
the response (success → transition state; already-voted → treat as success;
match-closed → transition to waiting; network error → clear the flag and
show an inline retry message). Don't wait for the response to disable the
buttons — that's the exact race the "immediately" is protecting against.

## Reconnect resilience for unattended screens

Bigscreen in particular runs unattended for hours. Beyond the
onopen-refetch rule above: don't assume the component tree survives a long
session without ever re-checking ground truth. If there's any client-side
caching or memoized state, expire/revalidate it on reconnect too, not just
the raw event stream — a stale `players` list held in a `useState` that
never gets refreshed independently of the stream is a common way this kind
of bug hides.

## What not to build here

- No client-side polling loop as a workaround/supplement to SSE — if the
  stream isn't delivering events reliably, fix the stream (see
  `nextjs-sse-redis` skill), don't paper over it with `setInterval` fetches
- No optimistic UI for admin state transitions (open/close/reveal) — those
  are rarer, deliberate actions by a human operator; a brief loading state
  on the button while the request resolves is fine and appropriate there,
  unlike the audience vote button which needs the immediate-lock pattern
