# Audience frontend spec

Mobile-first. One route (`app/(audience)/page.tsx`), rendered as a client-side
state machine — not three separate pages/URLs. State decides what's on screen;
there's nothing for the user to navigate to directly.

## States

```
INIT → SPLASH → (fetch current match status) → VOTING | SUCCESS | WAITING
VOTING → (vote submitted) → SUCCESS
```

- **SPLASH** — always shown first on load
- **VOTING** — shown if there's an open match and this voter hasn't voted in it
- **SUCCESS** — shown if there's an open match and this voter *has* voted in it
  (covers both "just voted" and "reloaded after voting")
- **WAITING** — shown if no match is currently open (between matches, or event
  hasn't started). Not one of your original 3 screens, but unavoidable — the
  app needs *some* state for this gap. Simplest option: reuse the splash
  visual, static (no auto-advance), no spinner needed yet. Do not build this
  out further than "same visual, no timer" unless asked.

Reload behavior: on every load, always show SPLASH first (consistent branded
entry), then resolve real state underneath during the splash timer via
`GET /api/matches/current`, so by the time the animation finishes the app
already knows which screen to land on. No visible loading state needed if the
splash duration comfortably covers the fetch.

## Screen 1 — Splash

- Full-bleed image/logo + a simple animation (fade, scale, or pulse — CSS
  keyframes, no animation library needed for something this simple; don't add
  Framer Motion or similar unless the animation gets more complex than that)
- Fixed duration (~2.5–3s), auto-advances — no user interaction
- During this window: fire `GET /api/matches/current` so the result is ready
  the moment the timer ends
- No skip button (per your choice) — keep it simple, one component, one timer

## Screen 2 — Voting

- Grid layout, 2 columns, scrollable for more players
- **PlayerCard** component: photo (fixed aspect ratio so the grid stays even
  regardless of source image dimensions), name below photo, vote button below
  name
- Tap vote button:
  1. Immediately disable *all* vote buttons on screen (optimistic lock —
     prevents double-tap and prevents voting for a second player while the
     request is in flight)
  2. POST the vote
  3. On success → transition to SUCCESS, passing along which player was voted for
  4. On failure:
     - already voted (race condition, e.g. voted from another tab) → treat as
       success, fetch current status, go to SUCCESS
     - match no longer open (closed mid-vote) → show a brief inline message
       and transition to WAITING
     - generic network error → re-enable buttons, show retry message inline
       (don't build a full toast/notification system for this — inline text
       is enough)
- No sorting/filtering/search — 8–10 players max per match, grid is enough

## Screen 3 — Success

- Confirms the vote: show the photo + name of the player they voted for
- Message indicating the vote is locked in for this match (no back button, no
  way to return to VOTING)
- Stays on this screen until the match lifecycle moves on. In Phase 1–2 (no
  realtime yet) this just means: nothing happens until the user manually
  reloads, at which point `GET /api/matches/current` resolves them into the
  next state correctly (WAITING if closed, VOTING if a new match opened and
  they haven't voted in it yet). Auto-transition via the SSE stream is a
  Phase 3 concern — don't build a polling loop here in Phase 1–2 just to
  simulate it early.

## Components

- `AudienceShell` — holds the state machine, owns the current state + fetched
  match data, renders the active screen
- `SplashScreen` — visual + timer, calls `onDone(matchStatus)`
- `VotingScreen` — receives match + players, renders grid
  - `PlayerCard` — photo, name, vote button; receives a `disabled` prop for
    the optimistic-lock behavior
- `SuccessScreen` — receives the voted player, renders confirmation
- `WaitingScreen` — minimal, reuses splash visual, no timer

## Explicit non-goals for this piece
- No animation library dependency — plain CSS transitions/keyframes only,
  unless a specific animation genuinely can't be done that way
- No polling loop to auto-refresh SUCCESS/WAITING screens in Phase 1–2 —
  that's what Phase 3's SSE stream is for
- No vote-changing UI — once POSTed, it's final, no edit path
- No card sorting, filtering, or search
- No toast/notification system — inline text messages are enough
