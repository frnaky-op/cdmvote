# Deployment — canmatchy.com

Manual deploy on a single Ubuntu VPS. No CI/CD — you SSH in, `git pull`,
and `docker compose up` by hand whenever there's an update. nginx (already
installed on the box) terminates TLS and reverse-proxies to the app
container; Postgres and Redis stay inside the Docker network, never exposed
to the internet.

## One-time server setup

Prerequisites on the VPS: Docker + the Compose plugin, nginx, certbot, git.

```bash
# Docker (skip if already installed)
curl -fsSL https://get.docker.com | sh

# certbot for TLS
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
```

Point canmatchy.com's DNS (A record for `canmatchy.com` and `www.canmatchy.com`)
at the VPS's IP before requesting a certificate — certbot's HTTP-01
challenge needs it resolving already.

### Clone and configure

```bash
git clone https://github.com/frnaky-op/cdmvote.git
cd cdmvote
```

Create `.env` in the project root (this is read by `docker-compose.prod.yml`
for variable substitution — it is gitignored, create it directly on the
server, never commit it):

```bash
cat > .env <<'EOF'
POSTGRES_PASSWORD=<generate: openssl rand -base64 24>
SESSION_SECRET=<generate: openssl rand -base64 32>
ADMIN_EMAIL=you@canmatchy.com
ADMIN_PASSWORD=<a real password, not the dev default>
EOF
```

### First deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml run --rm app npx prisma db seed
```

`migrate deploy` applies committed migrations only — it never generates new
ones from schema drift. `db seed` creates the admin user from
`ADMIN_EMAIL`/`ADMIN_PASSWORD`; it's an upsert, safe to re-run.

The app now listens on `127.0.0.1:3000` — not reachable from outside until
nginx is wired up next.

### nginx + TLS

```bash
sudo cp deploy/nginx/canmatchy.com.conf /etc/nginx/sites-available/canmatchy.com
sudo ln -s /etc/nginx/sites-available/canmatchy.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d canmatchy.com -d www.canmatchy.com
```

Certbot rewrites the site config in place to add the HTTPS server block and
redirect. The proxy settings in `deploy/nginx/canmatchy.com.conf`
(`proxy_buffering off`, long read/send timeouts, no chunked transfer
encoding) exist specifically so `/api/stream/*` SSE connections aren't
buffered or killed by nginx — don't strip them out if you later regenerate
the config through certbot or otherwise.

### Firewall

Only 80/443 need to be public; Postgres and Redis aren't published to the
host at all in `docker-compose.prod.yml`, and the app container only binds
`127.0.0.1:3000`, so `ufw` just needs:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

## Updating (repeat workflow)

Every time there's a new commit to deploy:

```bash
cd cdmvote
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy
```

Always run `migrate deploy` after `up -d --build`, even if you don't
remember a schema change — it's a no-op when there's nothing new to apply,
and skipping it is how the app and DB schema drift apart.

`postgres_data`, `redis_data`, and `uploads` are named Docker volumes —
they survive `up -d --build` and container recreation. Only
`docker compose down -v` would destroy them; never run that on the prod
stack unless you intend to wipe the database.

Rebuilt images pile up over time. Periodically:

```bash
docker image prune -f
```

## Rollback

```bash
git log --oneline -5   # find the last good commit
git checkout <commit>
docker compose -f docker-compose.prod.yml up -d --build
```

Note this doesn't reverse a migration that already ran — Prisma migrations
in this project are forward-only. If a bad deploy included a destructive
migration, restoring `postgres_data` from a backup is the real fix, not
`git checkout`.
