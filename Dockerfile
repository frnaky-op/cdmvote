# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
# Placeholder so `prisma generate` (schema-only, no DB connection) can
# resolve prisma.config.ts's env("DATABASE_URL") at build time. Real
# connection strings are supplied at container runtime, which overrides this.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# ---- deps: install once, reused by dev and builder ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: local development target, hot reload via bind mount ----
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- builder: production build ----
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runner: production image, requires next.config.ts `output: 'standalone'` ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "server.js"]
