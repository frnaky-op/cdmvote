#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

const name = process.argv[2];

if (!name) {
  console.error("Usage: npm run prisma:migrate <migration-name>");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "dev", "--name", name],
  { stdio: "inherit", shell: true }
);

process.exit(result.status ?? 1);
