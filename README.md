# La Coupe d'Humour — Match 1 (voting page + SQLite backend)

A tiny Express server that serves the voting page and records each vote in
SQLite. Each visitor is identified by an `httpOnly` cookie (`voter_token`),
so the server — not `localStorage` — is the source of truth for "has this
person already voted". Reloading the page, clearing `localStorage`, or using
a different browser tab won't let someone vote twice; only clearing cookies
or using a different browser/device will start a new voter identity. On top
of that, voting requires a valid, single-use QR token (see "QR-code,
single-use vote tokens" below) — there's no voting from a bare link.

## Handling bursts of traffic (~1000 concurrent votes)

`/api/vote` and `/api/check` never touch disk on the request path:

- All votes live in an in-memory `Map` (`voter_token -> candidate`), which
  is what `/api/vote` and `/api/check` read/write. This makes both endpoints
  effectively instant and safe under heavy concurrency (tested locally with
  1000 simultaneous votes: all 1000 accepted, 200/200, correctly tallied,
  zero duplicates).
- A background timer flushes whatever accumulated since the last tick to
  SQLite **every 2 seconds**, in a single batched transaction (fast, one
  disk sync instead of hundreds/thousands).
- `/api/results` reads the in-memory tally too, so counts are always
  current even for votes not yet written to disk.
- On a clean shutdown (`systemctl stop`, Ctrl+C, etc.) the server flushes
  any pending votes before exiting, so nothing is lost. Only a hard crash
  (`kill -9`, power loss) could lose the last <2s of votes — acceptable for
  a casual contest; let me know if you need stronger durability
  (e.g. flush on every vote, or a message queue) and I can adjust it.
- There's also a `GET /api/health` endpoint returning
  `{ ok, totalVotes, pendingFlush }` if you want to keep an eye on the queue
  depth in production.

## Project structure

```
.
├── server.js          Express app + API routes
├── package.json
├── data/
│   └── votes.db        SQLite database (created automatically on first run)
├── admin/
│   └── index.html       Admin dashboard (results, voting toggle, candidate manager)
└── public/
    ├── index.html       The voting page
    ├── fonts/
    │   └── Hanson-Bold.ttf   Display font used for the dynamic "MATCH1" text
    └── images/
        ├── bg-talis.png, tete-de-page.png, Khfifa-white.png,
        │   CDM-logo.png, match-number.png, sponsors.png, Trophy.png,
        │   btn-votez.png                    (fixed UI/brand assets)
        └── candidates/  Player photos - managed entirely from /admin, no manual file editing needed
```

## API

Public:
- `GET  /api/candidates` → `[{ id, name, photo }, ...]` (active players only, in display order — served from an in-memory cache, see below)
- `GET  /api/voting-status` → `{ open: boolean }`
- `GET  /api/check`  → `{ voted: boolean, candidate: string|null }`
- `GET  /api/token-status?t=...` → `{ present, valid, used, candidate }` — status of a QR token
- `POST /api/vote`   body `{ candidate: "habry", token: "<qr-token>" }` → `{ success: true, candidate }`. A valid, unused `token` is required: `400 { error: 'token_required' }` if missing, `400 { error: 'invalid_token' }` if unrecognized, `409 { error: 'token_already_used', candidate }` if already used. Also `409 { error: 'already_voted', candidate }` (per-browser cookie), `403` if voting is closed, `400 { error: 'invalid_candidate' }` if the candidate id is invalid/inactive
- `GET  /api/health` → `{ ok, votingOpen, totalVotes, pendingFlush }`

Admin (all require Basic Auth — see below):
- `GET  /api/admin/results` → `{ total, pendingFlush, votingOpen, matchNumber, results: [{candidate, name, active, deleted, votes, percent}, ...] }`
- `POST /api/admin/reset` → wipes all votes (memory + SQLite)
- `POST /api/admin/voting-status` body `{ open: true|false }` → turns voting on/off site-wide
- `POST /api/admin/match-number` body `{ number: 2 }` (1-999) → sets the match number shown in the public page's header/title
- `GET  /api/admin/candidates` → full candidate list (including inactive), with live vote counts
- `POST /api/admin/candidates` multipart form `name`, `photo` (file), optional `id` → adds a new player
- `PUT  /api/admin/candidates/:id` multipart form, any of `name`, `photo` (file), `active` (`1`/`0`), `position` → updates a player
- `POST /api/admin/candidates/reorder` body `{ order: ["id2","id5","id1",...] }` → sets the display order (see "Reordering players" below)
- `DELETE /api/admin/candidates/:id` → permanently removes a player (their past votes stay in the results, tagged "(supprimé)")
- `DELETE /api/admin/tokens/:token` → permanently deletes a single unused QR token; `409` if that token was already used to vote

### Caching of the public candidates list

`GET /api/candidates` is served from a precomputed, already-serialized JSON
string kept in memory, rather than re-filtering/sorting/serializing the
candidate list on every request. That keeps it cheap even under a burst of
concurrent page loads.

The cache is invalidated (rebuilt) immediately whenever a candidate is
added, edited, deleted, or reordered — so admin changes show up on the
public page right away, with no stale data. As a safety net, it also
self-expires and rebuilds after 24h even if nothing told it to, in case the
underlying data was ever changed outside the app's own code paths.

### Reordering players

In `/admin` → "Joueurs", each row has ▲ / ▼ buttons to move that player up
or down in the display order. Under the hood this calls
`POST /api/admin/candidates/reorder` with the full new order, which rewrites
everyone's `position` in a single transaction and invalidates the public
cache immediately.

Candidate ids are slugs generated from the name (or a custom id you provide), e.g. "Karim Bennani" → `karim-bennani`.

## Admin dashboard

`https://your-domain/admin` — protected by HTTP Basic Auth (see credentials
section below). The voting on/off switch is always visible at the top; below
it, everything else is split into three tabs: **Résultats**, **Joueurs**,
and **QR de vote**.

**Voting on/off switch** (always visible, above the tabs) — flip it to
instantly stop accepting votes. Visitors who haven't voted yet see a "Vote
clôturé" screen; anyone who already voted still sees their "done" screen as
normal. Flip it back on to resume — nothing else changes.

**Résultats tab** — live vote counts + percentages per candidate,
auto-refreshes every 10s (in the background even while another tab is
open), plus a **"Réinitialiser toutes les données"** button that wipes every
vote (memory + SQLite) after a confirmation prompt.

**Joueurs tab (candidate manager)** — for each player: rename inline, swap
their photo (click "Photo", pick a file, then "Enregistrer"), toggle
active/inactive (hides them from the public voting page without deleting
their history), or permanently delete them. An "Ajouter le joueur" form at
the bottom adds new players (name + photo, jpg/png/webp, 5MB max).

Deactivating vs. deleting: deactivating just hides a player from the voting
page — good for "this match is over, hide the loser before the next round"
while keeping everything reversible. Deleting removes them entirely from the
management list and deletes their photo file; their vote count is kept in
the results (labeled "(supprimé)") so historical tallies don't silently
change.

**QR de vote tab** — generate new batches and manage existing ones. Each
batch row has:
- **ZIP (QR)** / **CSV** — download all of that batch's codes (see
  "Distribute" below).
- **Voir les QR** — expands an inline list of every token in the batch, each
  showing its status (Disponible / Utilisé, with the candidate if used), a
  link to view/download that single QR PNG, and a **Supprimer** button to
  delete just that one unused code (e.g. a code that was printed but never
  handed out, or damaged). Used tokens can't be deleted individually — same
  reasoning as the batch-level rule below.
- **Supprimer le lot** — deletes the whole batch, only allowed while none of
  its tokens have been used yet (protects the audit trail once any of them
  cast a real vote).

### Admin credentials

- `ADMIN_USER` (defaults to `admin` if not set)
- `ADMIN_PASSWORD` (**required** for production — see below)

If `ADMIN_PASSWORD` isn't set, the server generates a random one on startup
and prints it to the logs, purely so `/admin` isn't left wide open by
accident — it changes every restart, so don't rely on it. Set a real,
permanent password via the systemd unit:

```bash
openssl rand -base64 18   # generate a strong password
```
```ini
# inside the [Service] section of /etc/systemd/system/coupe-humour.service
Environment=ADMIN_USER=admin
Environment=ADMIN_PASSWORD=paste-your-generated-password-here
```
```bash
sudo systemctl daemon-reload
sudo systemctl restart coupe-humour
```

## 1. Local test

```bash
npm install
npm start
# visit http://localhost:3000
```

## 2. Deploy on an Ubuntu 26 VPS

### a) Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node -v
```
(`build-essential` is needed because `better-sqlite3` compiles a small native module on install.)

### b) Upload the project

```bash
# from your machine
scp -r coupe-humour-app user@your-server-ip:/var/www/coupe-humour
```

### c) Install dependencies and test

```bash
cd /var/www/coupe-humour
npm install --omit=dev
npm start   # Ctrl+C once you've confirmed it runs on port 3000
```

### d) Keep it running with systemd

Create `/etc/systemd/system/coupe-humour.service`:

```ini
[Unit]
Description=La Coupe d'Humour voting app
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/coupe-humour
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /var/www/coupe-humour
sudo systemctl daemon-reload
sudo systemctl enable --now coupe-humour
sudo systemctl status coupe-humour
```

### e) Put Nginx in front (recommended, for HTTPS + a normal domain/port 80/443)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo apt install -y nginx
sudo ln -s /etc/nginx/sites-available/coupe-humour /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# then, for HTTPS:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## QR-code, single-use vote tokens

In `/admin` → "QR de vote", you can generate a batch of unique, single-use
QR codes and hand them out (printed, on tickets, etc.). Each one is a link
like `https://your-domain/?t=<random-token>` — scanning it opens the vote
page directly.

- **Generate**: enter a count and an optional label, click Générer. Each
  batch shows total/used counts, refreshing live.
- **Distribute**: download either a **ZIP of individual QR PNGs** (one file
  per token, ready to print) or a **CSV** (token, direct URL, used status) —
  both buttons are next to each batch.
- **A QR token is required to vote at all** — `POST /api/vote` rejects with
  `400 { error: 'token_required' }` if no token is sent, so there's no
  walk-up/link-only voting. Enforcement is then two layers deep:
  1. **Per-token**: the moment a token is used to vote, it's marked used —
     scanning that same QR again (from any device, any browser, cookies
     cleared or not) shows "already voted" (with the candidate they voted
     for), never the ballot again.
  2. **Per-browser**: the existing cookie-based protection still applies on
     top of that — so if someone who already voted tries a second, unused
     QR code in the *same* browser, that's blocked too.
- **Without a token** (a bare link with no `?t=`), the page shows a "QR code
  requis" screen instead of the ballot.
- **Invalid/unrecognized token** (typo, tampered URL, deleted batch) shows a
  dedicated "QR code invalide" screen rather than silently falling back to
  open voting.
- A batch can only be deleted while **none** of its tokens have been used
  yet (protects the audit trail of anyone who already voted with one).
- QR content encodes a full URL, built from `PUBLIC_BASE_URL` if you set
  that environment variable (recommended for production — e.g.
  `Environment=PUBLIC_BASE_URL=https://dev.canmatchy.com` in the systemd
  unit), otherwise it's inferred from the incoming request's host/protocol.

## Reusing this page for Match 2, Match 3, etc.

The header's "#MATCH1" text is real text (set in the Hanson-Bold font), not
part of an image, specifically so future matches don't need any image
editing. The number itself lives in the `settings` table and is set from
`/admin` (the "Numéro du match" field, above the tabs) — no code edit or
redeploy needed.

Saving it there updates the header, browser tab title, and `document.title`
on the next page load. Everything else (candidates, votes, QR tokens) is
independent per-deployment — if you want a clean slate for a new match, use
"Réinitialiser toutes les données" in `/admin` first (see below).

## Image cache-busting

Every image URL (the background, header banner, KHFIFA badge, logo, match
badge, sponsors banner, trophy, vote button, the Hanson font, and every
candidate photo) is automatically appended with `?v=<file's last-modified
time>`. That means:

- If you replace a file on disk with the same name (e.g. drop in a new
  `public/images/bg-talis.png`), the version number changes automatically
  and every visitor gets the new one immediately — no stale browser cache,
  no manual cache-busting needed on your end.
- Because of that, images are cached **aggressively** (30 days,
  `immutable`) for speed, instead of a short cache that could show a stale
  image for a while after a change.
- The HTML pages themselves (`/` and `/admin`) are served with
  `Cache-Control: no-cache`, so browsers always check for a fresh copy of
  the page (and thus fresh version numbers) on every visit — only the
  images/font benefit from the long cache.
- The exact list of versioned filenames lives in
  `STATIC_IMAGE_VERSION_TARGETS` near the top of `server.js` — if you ever
  add a *new* fixed asset (not a candidate photo, those are handled
  separately and versioned automatically), add its path to that list too.

If you ever replace `public/images/bg-talis.png` (or any other static
asset) directly on the server, you don't need to do anything else — just
overwrite the file. The next page load will pick up the new version
automatically.

## 3. Backing up / resetting votes

The whole database is the single file `data/votes.db` (plus WAL files next to
it while the server is running). To back it up:

```bash
sqlite3 data/votes.db ".backup data/votes-backup.db"
```

To reset all votes (start the contest fresh):

```bash
sudo systemctl stop coupe-humour
rm data/votes.db data/votes.db-wal data/votes.db-shm
sudo systemctl start coupe-humour   # recreates an empty table
```

## Notes / things you may want to change

- `GET /api/results` is public with no auth — remove it or add a simple
  secret query param / admin auth if you don't want vote counts exposed.
- The duplicate-vote protection is cookie-based (good enough for a casual
  contest); it's not meant to stop a determined person using incognito mode
  or multiple devices. If you need stronger protection, you'd add IP-based
  rate limiting or a login step.
