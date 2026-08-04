---
name: prisma-postgres-workflow
description: Prisma + Postgres conventions for this project — migration workflow (dev vs deploy), seeding, transaction patterns, and the Docker/Alpine binaryTargets gotcha already baked into prisma/schema.prisma. Use whenever running or writing Prisma migrations, seed scripts, transactions, or touching prisma/schema.prisma, and whenever debugging a Prisma Client error that only happens inside Docker (not locally).
---

# Prisma + Postgres workflow

## Migrations: dev vs deploy — don't mix these up

- **Local development**: `npx prisma migrate dev --name <description>`. This
  creates a new migration file from schema changes *and* applies it *and*
  regenerates the client. Use this whenever `prisma/schema.prisma` changes
  during local work.
- **Production (server/CI)**: `npx prisma migrate deploy`. This applies
  already-committed migration files — it does **not** generate new
  migrations from schema drift. The GitHub Actions deploy pipeline
  (`.github/workflows/deploy.yml`) runs this on every deploy, via
  `docker-compose.prod.yml run --rm app npx prisma migrate deploy`.
- Never run `migrate dev` against the production database. If a schema
  change is needed, run `migrate dev` locally to generate the migration
  file, commit it, and let the pipeline's `migrate deploy` apply it on the
  server.

## The Alpine binaryTargets gotcha (already handled, but know why)

`prisma/schema.prisma`'s generator block includes
`binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`. This exists
because the production Docker image is `node:20-alpine`, which uses musl
libc, not glibc — Prisma's default generated engine binary won't run there
without this. If Prisma Client throws an engine-not-found or "unable to
locate the Query Engine" error **only inside Docker** (not locally), check
this line hasn't been removed and that `npx prisma generate` ran *inside*
the Docker build (it does, in the `builder` stage of the `Dockerfile`) —
generating on the host and copying `node_modules` over would produce the
wrong binary target.

## Transactions

Use `prisma.$transaction([...])` (or the callback form for
dependent operations) any time an operation needs to update more than one
table atomically. The clearest example in this project: casting a vote
must insert the `Vote` row and increment `MatchParticipant.voteCount`
together — if one succeeds without the other, tallies drift from actual
votes. See the `match-voting-state-machine` skill for the specific rule.

## Seeding

A seed script (`prisma/seed.ts`, wired via the `prisma.seed` field in
`package.json`) should at minimum create the single `AdminUser` from
`ADMIN_EMAIL` / a hashed `ADMIN_PASSWORD` in `.env` — there's no
registration flow (see `docs/frontend-admin.md`), so without a seed step
there's no way to log in. Sample players are optional/convenient for local
dev but not required for the seed to be correct.

Don't build seeding logic that assumes it can run repeatedly and safely
no-op (upsert on the admin email) — reseeding shouldn't create duplicate
admin users or crash on unique constraint violations.

## Query conventions

- Prisma is the only DB access layer for this project (see CLAUDE.md) — no
  raw SQL unless a specific aggregation genuinely can't be expressed via
  Prisma's query API (the tally reconciliation `COUNT ... GROUP BY` in the
  match-voting-state-machine skill is expressible via
  `prisma.vote.groupBy({ by: ['playerId'], where: { matchId }, _count: true })`
  — reach for that before raw SQL).
- The active-player lookup for populating a new match's participant picker
  is just `prisma.player.findMany({ where: { tournamentId, status: 'active' } })`
  — no separate "eligible pool" concept, see the match-voting-state-machine
  skill for why.
