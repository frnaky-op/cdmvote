# Admin frontend spec

Authed area, `app/(admin)/*`, desktop-first (this is run by event staff on a
laptop, not mobile). Single admin user, no roles — every screen is available
to anyone logged in.

## Navigation / screens

- **Login** — email + password, sets session cookie, redirects to Dashboard
- **Dashboard** — tournament overview
- **Players** — list + create/edit
- **Matches** — list + create/edit
- **Match Control** — the live-ops screen for a single match; this is where
  staff spend most of their time during the actual event

Simple sidebar or top nav with these four sections (Login isn't nav, it's the
gate). Don't build anything more elaborate than that — no breadcrumbs, no
multi-level menus needed for four screens.

## Screen: Dashboard

- Current tournament name/status
- List of matches (position, state, participant count) in order — the
  currently open match (if any) should be visually prominent with a direct
  link into Match Control
- Quick counts: players remaining active, matches completed
- This is a summary/orientation screen, not where actions happen — keep it
  read-only except for links into Matches/Match Control

## Screen: Players

- Table/list: photo thumbnail, name, status (active/eliminated/winner badge)
- Create/Edit form: name, photo upload, bio (optional)
- Delete — only allow deleting a player who isn't assigned to any match yet;
  once assigned, editing name/photo/bio is fine but don't allow delete (would
  orphan MatchParticipant/Vote rows) — surface this as a disabled delete
  button with a short explanation, not a server error after the fact
- No bulk import/CSV upload — one at a time, this is a ~16-player roster,
  manual entry is fine

## Screen: Matches

- List: position, state badge, participant count, survivorsCount
- Create/Edit form:
  - position (1–5)
  - survivorsCount
  - participants — a picker limited to currently-`active` players (this is
    how carry-forward works: after Match 1/2 reveal, the survivors' status
    flips to active-and-available, so they show up in this picker for Match 3)
  - scheduledStart/scheduledEnd — optional fields, stored but **not
    enforced** in Phase 1–2 (no auto-open/auto-close cron logic until
    Phase 5, if ever requested) — treat these as informational/planning
    fields for now
- Editing participants after a match has moved past `scheduled` state should
  be blocked or at least strongly warned against — don't allow silently
  changing who's in an `open` or later match

## Screen: Match Control

The core operational screen — one match at a time, reached from Dashboard or
Matches list.

- Header: match position, current state badge
- Participant list: photo, name, and (admin-only) live vote count — this
  updates in real time via the admin SSE subscription while state is `open`
- Primary action button, changes based on state:
  - `scheduled` → **Open Voting**
  - `open` → **Close Voting**
  - `closed` → **Reveal Results** (participant list can show final tallies
    sorted descending here, since voting is already closed — no harm in
    admin seeing full numbers at this point)
  - `revealed` → no primary action; show final results, link to next match
- Only one primary action visible at a time — don't show Open/Close/Reveal as
  three permanent buttons, the state machine should hide invalid transitions
  entirely rather than disabling them, to avoid clutter and mistaken clicks
- Live vote count display: simple sorted list with numbers (or basic bars),
  no need for animated charts — this is a monitoring tool for staff, not a
  polished visual
- No manual override / force-transition / tie-break UI here yet — that's
  Phase 5, only build if requested later

## Auth

- Single admin user, seeded directly (no self-registration flow, no "forgot
  password" flow needed for an internal event tool) — if the password needs
  resetting, that's a direct DB update, not a UI feature
- Session cookie, standard login/logout — nothing more elaborate

## Explicit non-goals for this piece
- No multiple admin accounts / roles / permissions
- No CSV/bulk player import
- No enforcement of scheduledStart/scheduledEnd (informational only for now)
- No manual override / force-close / force-reopen / tie-break controls
- No analytics/reporting views beyond the live match tallies
- No audit log UI (the Vote table itself is the audit trail if ever needed,
  no need to expose it as a screen)
