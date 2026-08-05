# La Coupe d'Humour — Match 1 (voting page + SQLite backend)

A tiny Express server that serves the voting page and records each vote in
SQLite. Each visitor is identified by an `httpOnly` cookie (`voter_token`),
so the server — not `localStorage` — is the source of truth for "has this
person already voted". Reloading the page, clearing `localStorage`, or using
a different browser tab won't let someone vote twice; only clearing cookies
or using a different browser/device will start a new voter identity.

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
└── public/
    ├── index.html       The voting page
    └── images/          All PNG assets
```

## API

- `GET  /api/check`  → `{ voted: boolean, candidate: string|null }`
- `POST /api/vote`   body `{ candidate: "habry" }` → `{ success: true }` or `409` if already voted
- `GET  /api/results` → `[{ candidate, votes }, ...]` (remove/protect this if you don't want public tallies)

Candidate ids: `habry`, `bouabidi`, `aziza`, `monaim`, `labiad`, `lmalki`, `tazarin`, `addoul`.

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
