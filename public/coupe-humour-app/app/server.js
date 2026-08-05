// server.js
// Express + SQLite backend for "La Coupe d'Humour - Match 1" voting page.
//
// Designed for bursts of concurrent traffic (e.g. ~1000 simultaneous votes):
// votes are recorded in an in-memory Map immediately (so /api/vote and
// /api/check never touch the disk on the hot path), and a background timer
// flushes everything accumulated since the last tick to SQLite every 2
// seconds in a single batched transaction. Nothing is lost on a clean
// shutdown (SIGINT/SIGTERM flush before exit); a hard crash could lose at
// most the last <2s of votes.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'votes.db');
const FLUSH_INTERVAL_MS = 2000;

const CANDIDATES = new Set([
  'habry',
  'bouabidi',
  'aziza',
  'monaim',
  'labiad',
  'lmalki',
  'tazarin',
  'addoul',
]);

// ---- Database setup -------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate    TEXT NOT NULL,
    voter_token  TEXT NOT NULL UNIQUE,
    ip           TEXT,
    user_agent   TEXT,
    created_at   DATETIME NOT NULL
  );
`);

const insertVoteStmt = db.prepare(
  `INSERT OR IGNORE INTO votes (candidate, voter_token, ip, user_agent, created_at)
   VALUES (@candidate, @voter_token, @ip, @user_agent, @created_at)`
);

const insertManyVotes = db.transaction((rows) => {
  for (const row of rows) insertVoteStmt.run(row);
});

// ---- In-memory state (source of truth for the hot path) -------------------
// voterIndex: voter_token -> candidate. Pre-warmed from the DB at boot, then
// updated synchronously the instant a vote is accepted, so duplicate checks
// and the "already voted" response never wait on disk I/O.
const voterIndex = new Map();

// tally: candidate -> vote count, kept in sync with voterIndex so
// /api/results is O(1) and always reflects reality, not just what's been
// flushed to disk yet.
const tally = new Map([...CANDIDATES].map((c) => [c, 0]));

// pendingWrites: voter_token -> full row waiting to be persisted. Drained
// and cleared by the flush timer every FLUSH_INTERVAL_MS.
let pendingWrites = new Map();

// Load existing votes into memory on startup so counts/duplicate checks
// survive a restart.
for (const row of db.prepare('SELECT candidate, voter_token FROM votes').all()) {
  voterIndex.set(row.voter_token, row.candidate);
  tally.set(row.candidate, (tally.get(row.candidate) || 0) + 1);
}
console.log(`Loaded ${voterIndex.size} existing votes from ${DB_PATH}`);

function flushToDisk() {
  if (pendingWrites.size === 0) return;
  const rows = Array.from(pendingWrites.values());
  pendingWrites = new Map(); // swap in a fresh map so new votes keep queuing
                              // without waiting on this flush
  try {
    insertManyVotes(rows);
  } catch (err) {
    console.error(`Failed to flush ${rows.length} vote(s) to disk:`, err);
    // Put them back so the next tick retries rather than losing them.
    for (const row of rows) {
      if (!pendingWrites.has(row.voter_token)) {
        pendingWrites.set(row.voter_token, row);
      }
    }
  }
}

const flushTimer = setInterval(flushToDisk, FLUSH_INTERVAL_MS);

function shutdown(signal) {
  console.log(`\nReceived ${signal}, flushing pending votes and exiting...`);
  clearInterval(flushTimer);
  flushToDisk();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---- App setup --------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// --- tiny cookie helpers (no extra dependency needed) ---
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

function getOrCreateVoterToken(req, res) {
  const cookies = parseCookies(req);
  let token = cookies['voter_token'];
  if (!token) {
    token = crypto.randomUUID();
    res.setHeader(
      'Set-Cookie',
      `voter_token=${token}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 5}; HttpOnly; SameSite=Lax`
    );
  }
  return token;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress;
}

// ---- API routes (all read/write the in-memory state only) ----------------

app.get('/api/check', (req, res) => {
  const token = getOrCreateVoterToken(req, res);
  const candidate = voterIndex.get(token) || null;
  res.json({ voted: !!candidate, candidate });
});

app.post('/api/vote', (req, res) => {
  const token = getOrCreateVoterToken(req, res);
  const { candidate } = req.body || {};

  if (!candidate || !CANDIDATES.has(candidate)) {
    return res.status(400).json({ error: 'invalid_candidate' });
  }

  const existing = voterIndex.get(token);
  if (existing) {
    return res.status(409).json({ error: 'already_voted', candidate: existing });
  }

  // Record immediately in memory - this is what makes concurrent bursts
  // safe and fast: no disk write is on this request's critical path.
  voterIndex.set(token, candidate);
  tally.set(candidate, (tally.get(candidate) || 0) + 1);
  pendingWrites.set(token, {
    candidate,
    voter_token: token,
    ip: getClientIp(req),
    user_agent: req.headers['user-agent'] || '',
    created_at: new Date().toISOString(),
  });

  res.json({ success: true, candidate });
});

app.get('/api/results', (req, res) => {
  const rows = Array.from(tally.entries())
    .map(([candidate, votes]) => ({ candidate, votes }))
    .sort((a, b) => b.votes - a.votes);
  res.json(rows);
});

// Simple operational endpoint: how many votes are waiting to be written.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    totalVotes: voterIndex.size,
    pendingFlush: pendingWrites.size,
  });
});

app.listen(PORT, () => {
  console.log(`La Coupe d'Humour server running on http://localhost:${PORT}`);
});
