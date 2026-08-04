# Bigscreen frontend spec

Single route (`app/(bigscreen)/page.tsx`), unattended, full-screen, driven
entirely by the public SSE stream (`match_opened`, `match_closed`,
`match_revealed`) plus a REST fetch on load/reconnect. No user interaction —
nobody is touching this screen, it's a TV/projector.

## States

```
IDLE → (match_opened) → OPEN → (match_closed) → TALLYING → (match_revealed) → REVEAL → (next match_opened) → OPEN ...
```

- **IDLE** — no match currently open. Shown before the event starts, between
  matches, and after the tournament completes (with different copy for the
  last case — see below)
- **OPEN** — a match is live and accepting votes
- **TALLYING** — voting just closed, results not yet revealed (this gap
  exists because open→closed and closed→revealed are separate admin actions,
  by design, for suspense)
- **REVEAL** — playing/showing the outcome of the just-closed match

## Screen: IDLE

- Tournament branding (logo, name), calm/ambient — this is what's on screen
  before doors open or during a break between matches
- If the *next* match is already scheduled and its participants assigned,
  optionally show "Up next: Match N" with a small preview of who's in it —
  nice touch, but skip this if it adds real complexity; a static branded
  holding screen is a perfectly good MVP
- **Tournament-complete variant**: once Match 5 has been revealed, IDLE
  should instead show the winner front and center (photo, name, "Champion" or
  similar) rather than reverting to generic branding. This is a copy/data
  difference on the same screen, not a new state — check
  `tournament.status === completed` and branch the render

## Screen: OPEN

- Grid of player cards — photo + name only, **no vote counts, no vote
  buttons** (this is a display screen, not interactive)
- QR code, visible the entire time the match is open, linking to the
  audience voting URL — same QR code/link for every match, no need to
  regenerate per match (the audience app resolves "which match is currently
  open" itself on load, per the audience spec)
- Match progress indicator — "Match 3 of 5" or similar, simple text, not a
  visual bracket (a full bracket visualization is a nice-to-have, not MVP)
- No live counts — confirmed design choice, stays blind until reveal

## Screen: TALLYING

- Brief, low-key transitional screen: "Tallying votes..." or similar,
  players' cards can stay visible but visually muted/static, QR code can fade
  out here since voting is closed
- This state has no fixed duration — it lasts as long as it takes the admin
  to hit "Reveal." Don't build a timer or auto-advance out of TALLYING.

## Screen: REVEAL

- Triggered by the `match_revealed` event, which includes each participant's
  result (advanced / eliminated / winner)
- Animation: reveal each player's outcome — simplest solid approach is
  revealing in ascending order of vote count (lowest first) so the last
  reveal is the most-voted player, building suspense toward the top. This
  requires the `match_revealed` payload to include enough info to order by
  result cleanly (advanced/winner players revealed last, eliminated first) —
  vote counts themselves don't need to be shown, just the reveal *order* uses
  them
- Visually distinguish advanced/winner (stays highlighted, moves toward
  "next round" framing) from eliminated (fades/greys out)
- For the Match 5 reveal specifically, the final reveal is the tournament
  winner — treat this as a bigger visual moment (confetti/celebratory
  styling is a nice-to-have, don't block MVP on it)
- After REVEAL finishes playing, screen sits there until admin opens the
  next match (transitions back to IDLE only implicitly, when match_opened
  fires) — no auto-timeout back to IDLE

## Reconnect / resilience

- On mount and on SSE reconnect, always fetch current tournament/match state
  via REST first, then attach to the stream — never assume the stream will
  replay missed events. This screen may be sitting unattended for hours; a
  dropped wifi connection must not leave it frozen on stale data.

## Explicit non-goals for this piece
- No interactivity of any kind — no click handlers, no admin controls
  reachable from this screen
- No visual bracket/tournament tree — text progress indicator is enough
- No per-match QR codes — one link for the whole event
- No live vote counts or bars — confirmed blind design
- No auto-timeout out of REVEAL back to IDLE
