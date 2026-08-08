// server.js
// Express + SQLite backend for "La Coupe d'Humour" voting page.
//
// - Votes are recorded in an in-memory Map immediately (so /api/vote never
//   touches the disk on the hot path), and a background timer flushes
//   everything accumulated since the last tick to SQLite every 2 seconds in
//   a single batched transaction. Nothing is lost on a clean shutdown
//   (SIGINT/SIGTERM flush before exit); a hard crash could lose at most the
//   last <2s of votes.
// - Candidates (players) are stored in SQLite and mirrored into an
//   in-memory cache, managed entirely from /admin: add, rename, replace
//   photo, deactivate/reactivate, or permanently delete.
// - Voting can be paused/resumed at any time from /admin without taking
//   the site down - the page just shows a "voting closed" screen while
//   still honouring anyone who already voted (they still see "done").
// - Vote identity is the single-use QR token, not the browser: the same
//   device can legitimately cast several votes (e.g. a shared tablet at the
//   door), each with its own token. The voter_token cookie is kept only as
//   an audit trail (which browser cast a given vote), not as a gate.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const multer = require('multer');
const QRCode = require('qrcode');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'votes.db');
const CANDIDATE_IMAGES_DIR = path.join(__dirname, 'public', 'images', 'candidates');
const FLUSH_INTERVAL_MS = 2000;
// Used to build the full URL encoded in each QR code (e.g. https://canmatchy.com/?t=abc123).
// Set this in production (systemd Environment=) to your real public URL;
// falls back to reading it off the request (protocol + host) otherwise.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(CANDIDATE_IMAGES_DIR, { recursive: true });

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.warn('==============================================================');
  console.warn('ADMIN_PASSWORD is not set. Generated a temporary one for this');
  console.warn('run only - it will change on every restart:');
  console.warn(`  user:     ${ADMIN_USER}`);
  console.warn(`  password: ${ADMIN_PASSWORD}`);
  console.warn('Set ADMIN_USER / ADMIN_PASSWORD as real environment variables');
  console.warn('(e.g. in the systemd unit file) before going to production.');
  console.warn('==============================================================');
}

// ---- Database setup -------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate    TEXT NOT NULL,
    voter_token  TEXT NOT NULL,
    qr_token     TEXT UNIQUE,
    ip           TEXT,
    user_agent   TEXT,
    created_at   DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    photo      TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS token_batches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT,
    count      INTEGER NOT NULL,
    created_at DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vote_tokens (
    token      TEXT PRIMARY KEY,
    batch_id   INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    candidate  TEXT,
    used_at    DATETIME,
    created_at DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vote_tokens_batch ON vote_tokens(batch_id);
`);

// Migration: older databases created before qr_token existed on votes.
{
  const cols = db.prepare('PRAGMA table_info(votes)').all().map((c) => c.name);
  if (!cols.includes('qr_token')) {
    db.exec('ALTER TABLE votes ADD COLUMN qr_token TEXT');
  }
}

// Migration: vote identity moved from "one vote per browser" to "one vote
// per QR token" - a device/browser can now legitimately cast several votes
// (e.g. a shared tablet at the door), so voter_token can no longer be
// UNIQUE, and qr_token (already the real per-vote identity, enforced in
// memory via tokenMeta.used) takes over that constraint at the DB level
// too. SQLite has no ALTER TABLE for dropping/adding constraints, so the
// table is rebuilt when the old constraint is detected.
{
  const tableSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'votes'`)
    .get();
  if (tableSql && /voter_token\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql.sql)) {
    db.exec(`
      CREATE TABLE votes_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate    TEXT NOT NULL,
        voter_token  TEXT NOT NULL,
        qr_token     TEXT UNIQUE,
        ip           TEXT,
        user_agent   TEXT,
        created_at   DATETIME NOT NULL
      );
      INSERT INTO votes_new (id, candidate, voter_token, qr_token, ip, user_agent, created_at)
        SELECT id, candidate, voter_token, qr_token, ip, user_agent, created_at FROM votes;
      DROP TABLE votes;
      ALTER TABLE votes_new RENAME TO votes;
    `);
    console.log('[migration] votes.voter_token is no longer UNIQUE; votes.qr_token is now UNIQUE.');
  }
}

// Seed the original 8 players once, on first run only.
if (db.prepare('SELECT COUNT(*) c FROM candidates').get().c === 0) {
  const seed = [
    ['habry', 'Abdelhady Elhabry', 'habry.png', 1],
    ['bouabidi', 'Youssef Bouabidie', 'bouabidi.png', 2],
    ['aziza', 'Aziza Noughi', 'aziza.png', 3],
    ['monaim', 'Abdelmonaim Essafoury', 'monaim.png', 4],
    ['labiad', 'Ayoub Elbiad', 'labiad.png', 5],
    ['lmalki', 'Said Elmalky', 'lmalki.png', 6],
    ['tazarin', 'Samir Tazarine', 'tazarin.png', 7],
    ['addoul', 'Anas Addoul', 'addoul.png', 8],
  ];
  const insertSeed = db.prepare(
    'INSERT INTO candidates (id, name, photo, position, active) VALUES (?, ?, ?, ?, 1)'
  );
  const insertSeedMany = db.transaction((rows) => {
    for (const r of rows) insertSeed.run(...r);
  });
  insertSeedMany(seed);
  console.log(`Seeded ${seed.length} initial candidates.`);
}

if (!db.prepare('SELECT value FROM settings WHERE key = ?').get('voting_open')) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('voting_open', '1');
}

if (!db.prepare('SELECT value FROM settings WHERE key = ?').get('match_number')) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('match_number', '1');
}

if (!db.prepare('SELECT value FROM settings WHERE key = ?').get('podium_count')) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('podium_count', '3');
}

const insertVoteStmt = db.prepare(
  `INSERT OR IGNORE INTO votes (candidate, voter_token, qr_token, ip, user_agent, created_at)
   VALUES (@candidate, @voter_token, @qr_token, @ip, @user_agent, @created_at)`
);
const insertManyVotes = db.transaction((rows) => {
  for (const row of rows) insertVoteStmt.run(row);
});

const markTokenUsedStmt = db.prepare(
  `UPDATE vote_tokens SET used = 1, candidate = ?, used_at = ? WHERE token = ?`
);
const markManyTokensUsed = db.transaction((rows) => {
  for (const row of rows) markTokenUsedStmt.run(row.candidate, row.used_at, row.token);
});

// ---- In-memory state (source of truth for the hot path) -------------------

// voterIndex: qr_token -> candidate id. Vote identity is the QR token, not
// the browser - the same device can legitimately cast several votes (each
// with its own token), so this is keyed by qr_token rather than the
// voter_token cookie.
const voterIndex = new Map();

// tally: candidate id -> vote count (includes ids of deleted candidates,
// so historical results stay intact even after a candidate is removed).
const tally = new Map();

// pendingWrites: qr_token -> full row waiting to be persisted to SQLite.
let pendingWrites = new Map();

// tokenMeta: qr token -> { batchId, used, candidate }. Pre-loaded from SQLite
// at boot, then updated synchronously the instant a QR-token vote is
// accepted - same "instant in memory, batched to disk" pattern as votes.
const tokenMeta = new Map();

// pendingTokenUpdates: token -> { candidate, used_at } waiting to be
// persisted (flushed on the same 2s timer as votes).
let pendingTokenUpdates = new Map();

function reloadTokenMeta() {
  tokenMeta.clear();
  const rows = db.prepare('SELECT token, batch_id, used, candidate, used_at FROM vote_tokens').all();
  for (const row of rows) {
    tokenMeta.set(row.token, {
      batchId: row.batch_id,
      used: !!row.used,
      candidate: row.candidate,
      usedAt: row.used_at,
    });
  }
}
reloadTokenMeta();

// candidatesCache: id -> { id, name, photo, position, active }
const candidatesCache = new Map();

// Precomputed JSON for the public /api/candidates response, so a burst of
// concurrent page loads doesn't re-filter/sort/serialize the list on every
// single request. Invalidated (recomputed) the instant a candidate is
// added/edited/deleted/reordered, and also expires on its own after 1 day
// as a safety net (CACHE_TTL_MS below) in case anything ever changes the
// DB outside of these code paths.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
let candidatesJsonCache = '[]';
let candidatesJsonCacheAt = 0;

function reloadCandidatesCache() {
  candidatesCache.clear();
  const rows = db
    .prepare('SELECT id, name, photo, position, active FROM candidates ORDER BY position ASC, name ASC')
    .all();
  for (const row of rows) candidatesCache.set(row.id, row);

  // Rebuild the public-facing cache right away (this is the "remove cache
  // after update" half of the requirement).
  const publicList = Array.from(candidatesCache.values())
    .filter((c) => c.active)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, photo: candidatePhotoUrl(c.photo) }));
  candidatesJsonCache = JSON.stringify(publicList);
  candidatesJsonCacheAt = Date.now();
}
reloadCandidatesCache();

function getCandidatesJson() {
  // The "remove cache after 1 day" half: force a rebuild if the cached
  // value is older than CACHE_TTL_MS, even if nothing told us to invalidate.
  if (Date.now() - candidatesJsonCacheAt > CACHE_TTL_MS) {
    reloadCandidatesCache();
  }
  return candidatesJsonCache;
}

let votingOpen = true;
{
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('voting_open');
  votingOpen = row ? row.value === '1' : true;
}

// The match number shown in the page header/title - set from /admin instead
// of being hardcoded in public/index.html, so switching to Match 2, Match 3,
// etc. is a dashboard action rather than a code edit + redeploy.
let matchNumber = 1;
{
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('match_number');
  matchNumber = row ? Number(row.value) || 1 : 1;
}

// How many ranked players the admin's Podium tab shows (top 3 as the podium
// itself, the rest as a ranked list below it) - set from /admin.
let podiumCount = 3;
{
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('podium_count');
  podiumCount = row ? Number(row.value) || 3 : 3;
}

// Load existing votes into memory on startup so counts/duplicate checks
// survive a restart. Falls back to a synthetic key for pre-QR-token
// legacy rows (qr_token was nullable before it became mandatory), so they
// don't all collapse into a single voterIndex entry.
for (const row of db.prepare('SELECT id, candidate, qr_token FROM votes').all()) {
  voterIndex.set(row.qr_token || `legacy-${row.id}`, row.candidate);
  tally.set(row.candidate, (tally.get(row.candidate) || 0) + 1);
}
console.log(`Loaded ${voterIndex.size} existing votes and ${candidatesCache.size} candidates from ${DB_PATH}`);

function flushToDisk() {
  if (pendingWrites.size > 0) {
    const rows = Array.from(pendingWrites.values());
    pendingWrites = new Map();
    try {
      insertManyVotes(rows);
    } catch (err) {
      console.error(`Failed to flush ${rows.length} vote(s) to disk:`, err);
      for (const row of rows) {
        if (!pendingWrites.has(row.qr_token)) {
          pendingWrites.set(row.qr_token, row);
        }
      }
    }
  }

  if (pendingTokenUpdates.size > 0) {
    const tokenRows = Array.from(pendingTokenUpdates.values());
    pendingTokenUpdates = new Map();
    try {
      markManyTokensUsed(tokenRows);
    } catch (err) {
      console.error(`Failed to flush ${tokenRows.length} token update(s) to disk:`, err);
      for (const row of tokenRows) {
        if (!pendingTokenUpdates.has(row.token)) {
          pendingTokenUpdates.set(row.token, row);
        }
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
app.set('trust proxy', true); // so req.protocol/req.hostname reflect X-Forwarded-* from nginx
app.use(express.json());

function generateToken() {
  // 8 random bytes -> 11-char base64url string. ~2^64 possibilities, so
  // collisions are effectively impossible even generating tens of thousands.
  return crypto.randomBytes(8).toString('base64url');
}

function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function voteUrl(req, token) {
  return `${getBaseUrl(req)}/?t=${token}`;
}

// ---- Cache-busting for static assets ---------------------------------------
// Problem this solves: express.static was caching images for a day by
// filename, so replacing a file (e.g. a new bg.png, or an admin swapping a
// candidate's photo) kept serving the OLD cached copy to anyone who'd
// already visited, for up to 24h.
//
// Fix: every image URL gets a ?v=<file mtime> query string appended. The
// content only changes when the file's mtime changes, so:
//   - unchanged files keep being served straight from cache (fast), and
//   - a changed file gets a brand new URL the instant it's replaced, so
//     browsers are guaranteed to fetch the new version, not the cached one.
// That lets us safely cache images "forever" (immutable) instead of 1 day.
function fileVersion(absPath) {
  try {
    return Math.floor(fs.statSync(absPath).mtimeMs);
  } catch (e) {
    return Date.now();
  }
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_IMAGE_VERSION_TARGETS = [
  'images/bg-talis.png',
  'images/tete-de-page.png',
  'images/Khfifa-white.png',
  'images/CDM-logo.png',
  'images/match-number.png',
  'images/sponsors.png',
  'images/Trophy.png',
  'images/btn-votez.png',
  'images/icon-done.png',
  'fonts/Hanson-Bold.ttf',
];

function renderVersionedHtml(templatePath, extraReplacements) {
  let html = fs.readFileSync(templatePath, 'utf8');
  for (const rel of STATIC_IMAGE_VERSION_TARGETS) {
    const abs = path.join(PUBLIC_DIR, rel);
    const versioned = `${rel}?v=${fileVersion(abs)}`;
    html = html.split(rel).join(versioned);
  }
  if (extraReplacements) {
    for (const [from, to] of extraReplacements) html = html.split(from).join(to);
  }
  return html;
}

// The voting page - served dynamically so the static image URLs above can
// be versioned, instead of being served as a plain static file.
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  // Tells the browser to purge its HTTP cache for this origin the moment
  // this request lands - cleans up anyone whose old cached assets/pages
  // are still hanging around from before the cache-busting fix, without
  // touching cookies.
  res.set('Clear-Site-Data', '"cache"');
  res.send(renderVersionedHtml(path.join(PUBLIC_DIR, 'index.html'), [
    ['{{MATCH_NUMBER}}', String(matchNumber)],
  ]));
});

// A direct hit on /index.html must not fall through to express.static below
// - that would serve the raw template, unversioned image paths and all,
// and (since public/index.html now contains a {{MATCH_NUMBER}} placeholder
// meant to be replaced by renderVersionedHtml) a JS syntax error in the
// page's own <script>. Redirect it to '/' so it always goes through the
// same rendering path.
app.get('/index.html', (req, res) => res.redirect(301, '/'));

// Everything else in public/ (images, etc.) - long, effectively-immutable
// caching is safe now that content changes always get a new ?v= URL.
// Exception: .html files are excluded from that long caching (set to
// no-cache instead) so a direct hit on /index.html can't bypass the
// versioning above and get stuck cached for 30 days with stale image URLs.
app.use(
  express.static(PUBLIC_DIR, {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

function candidatePhotoUrl(filename) {
  const abs = path.join(CANDIDATE_IMAGES_DIR, filename);
  return `/images/candidates/${filename}?v=${fileVersion(abs)}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('invalid_file_type'), ok);
  },
});

function extFromMime(mime) {
  return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[mime] || '.png';
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 40);
}

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

// --- HTTP Basic Auth for the admin area (constant-time comparison) ---
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIdx = decoded.indexOf(':');
    const user = sepIdx === -1 ? decoded : decoded.slice(0, sepIdx);
    const pass = sepIdx === -1 ? '' : decoded.slice(sepIdx + 1);

    if (timingSafeEqualStr(user, ADMIN_USER) && timingSafeEqualStr(pass, ADMIN_PASSWORD)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin Area", charset="UTF-8"');
  res.status(401).send('Authentication required.');
}

// ==== PUBLIC API =============================================================

app.get('/api/voting-status', (req, res) => {
  res.json({ open: votingOpen });
});

app.get('/api/candidates', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.send(getCandidatesJson());
});

app.get('/api/token-status', (req, res) => {
  const token = String(req.query.t || '');
  if (!token) return res.json({ present: false });

  const meta = tokenMeta.get(token);
  if (!meta) return res.json({ present: true, valid: false });

  res.json({ present: true, valid: true, used: meta.used, candidate: meta.candidate || null });
});

app.post('/api/vote', (req, res) => {
  // The voter_token cookie is kept purely as an audit trail (which browser
  // cast this vote) - it is no longer a gate. Vote identity is the QR
  // token: it is what's required to be valid and unused below, and it's
  // what everything downstream (voterIndex, pendingWrites) is keyed by.
  // This means the same device can legitimately cast multiple votes (each
  // with its own token) - e.g. a shared tablet at the door.
  const cookieToken = getOrCreateVoterToken(req, res);
  const { candidate, token: qrToken } = req.body || {};

  if (!qrToken) {
    return res.status(400).json({ error: 'token_required' });
  }
  const qrMeta = tokenMeta.get(qrToken);
  if (!qrMeta) {
    return res.status(400).json({ error: 'invalid_token' });
  }
  if (qrMeta.used) {
    return res.status(409).json({ error: 'token_already_used', candidate: qrMeta.candidate });
  }

  if (!votingOpen) {
    return res.status(403).json({ error: 'voting_closed' });
  }

  const cand = candidatesCache.get(candidate);
  if (!cand || !cand.active) {
    return res.status(400).json({ error: 'invalid_candidate' });
  }

  // Record immediately in memory - this is what makes concurrent bursts
  // safe and fast: no disk write is on this request's critical path.
  voterIndex.set(qrToken, candidate);
  tally.set(candidate, (tally.get(candidate) || 0) + 1);
  pendingWrites.set(qrToken, {
    candidate,
    voter_token: cookieToken,
    qr_token: qrToken,
    ip: getClientIp(req),
    user_agent: req.headers['user-agent'] || '',
    created_at: new Date().toISOString(),
  });

  const usedAt = new Date().toISOString();
  qrMeta.used = true;
  qrMeta.candidate = candidate;
  qrMeta.usedAt = usedAt;
  pendingTokenUpdates.set(qrToken, { token: qrToken, candidate, used_at: usedAt });

  res.json({ success: true, candidate });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    votingOpen,
    totalVotes: voterIndex.size,
    pendingFlush: pendingWrites.size,
    pendingTokenFlush: pendingTokenUpdates.size,
  });
});

// ==== ADMIN AREA (HTTP Basic Auth) ==========================================

app.get('/admin', requireAdminAuth, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// --- results & reset ---

app.get('/api/admin/results', requireAdminAuth, (req, res) => {
  const total = voterIndex.size;
  const ids = new Set([...candidatesCache.keys(), ...tally.keys()]);
  const results = Array.from(ids)
    .map((id) => {
      const votes = tally.get(id) || 0;
      const cand = candidatesCache.get(id);
      return {
        candidate: id,
        name: cand ? cand.name : `${id} (supprimé)`,
        photo: cand ? candidatePhotoUrl(cand.photo) : null,
        active: cand ? !!cand.active : false,
        deleted: !cand,
        votes,
        percent: total > 0 ? Math.round((votes / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);
  res.json({ total, pendingFlush: pendingWrites.size, votingOpen, matchNumber, podiumCount, results });
});

app.post('/api/admin/reset', requireAdminAuth, (req, res) => {
  voterIndex.clear();
  tally.clear();
  for (const id of candidatesCache.keys()) tally.set(id, 0);
  pendingWrites = new Map();
  pendingTokenUpdates = new Map();
  try {
    db.exec('DELETE FROM votes;');
    db.exec('UPDATE vote_tokens SET used = 0, candidate = NULL, used_at = NULL;');
  } catch (err) {
    console.error('Failed to reset votes table:', err);
    return res.status(500).json({ error: 'reset_failed' });
  }
  reloadTokenMeta();
  console.log(`[admin] All votes and QR tokens reset by ${getClientIp(req)} at ${new Date().toISOString()}`);
  res.json({ success: true });
});

// --- voting on/off switch ---

app.post('/api/admin/voting-status', requireAdminAuth, (req, res) => {
  const open = !!(req.body && req.body.open);
  votingOpen = open;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('voting_open', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(open ? '1' : '0');
  console.log(`[admin] Voting turned ${open ? 'ON' : 'OFF'} by ${getClientIp(req)}`);
  res.json({ success: true, open: votingOpen });
});

// --- match number (header/title) ---

app.post('/api/admin/match-number', requireAdminAuth, (req, res) => {
  const n = Math.floor(Number(req.body && req.body.number));
  if (!Number.isFinite(n) || n < 1 || n > 999) {
    return res.status(400).json({ error: 'invalid_number' });
  }
  matchNumber = n;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('match_number', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(n));
  console.log(`[admin] Match number set to ${n} by ${getClientIp(req)}`);
  res.json({ success: true, number: matchNumber });
});

// --- podium size (admin Podium tab) ---

app.post('/api/admin/podium-count', requireAdminAuth, (req, res) => {
  const n = Math.floor(Number(req.body && req.body.count));
  if (!Number.isFinite(n) || n < 1 || n > 999) {
    return res.status(400).json({ error: 'invalid_number' });
  }
  podiumCount = n;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('podium_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(n));
  console.log(`[admin] Podium count set to ${n} by ${getClientIp(req)}`);
  res.json({ success: true, count: podiumCount });
});

// --- candidate management: list / add / update / delete ---

app.get('/api/admin/candidates', requireAdminAuth, (req, res) => {
  const rows = db
    .prepare('SELECT id, name, photo, position, active FROM candidates ORDER BY position ASC, name ASC')
    .all()
    .map((c) => ({ ...c, photo: candidatePhotoUrl(c.photo), votes: tally.get(c.id) || 0 }));
  res.json(rows);
});

// Reorder players: body { order: ["id2", "id5", "id1", ...] } - full list of
// candidate ids in the desired display order. Positions are rewritten as
// 1..N to match, in a single transaction.
app.post('/api/admin/candidates/reorder', requireAdminAuth, (req, res) => {
  const order = Array.isArray(req.body && req.body.order) ? req.body.order : null;
  if (!order || order.length === 0) {
    return res.status(400).json({ error: 'order_required' });
  }

  const existingIds = new Set(db.prepare('SELECT id FROM candidates').all().map((r) => r.id));
  for (const id of order) {
    if (!existingIds.has(id)) {
      return res.status(400).json({ error: 'unknown_candidate', id });
    }
  }

  const updateStmt = db.prepare('UPDATE candidates SET position = ? WHERE id = ?');
  const updateMany = db.transaction((ids) => {
    ids.forEach((id, i) => updateStmt.run(i + 1, id));
  });
  updateMany(order);

  reloadCandidatesCache();
  console.log(`[admin] Candidates reordered by ${getClientIp(req)}`);
  res.json({ success: true });
});

app.post('/api/admin/candidates', requireAdminAuth, upload.single('photo'), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!req.file) return res.status(400).json({ error: 'photo_required' });

  let id = slugify(req.body.id || name);
  if (!id) return res.status(400).json({ error: 'invalid_id' });
  if (db.prepare('SELECT 1 FROM candidates WHERE id = ?').get(id)) {
    return res.status(409).json({ error: 'id_exists' });
  }

  const filename = `${id}${extFromMime(req.file.mimetype)}`;
  fs.writeFileSync(path.join(CANDIDATE_IMAGES_DIR, filename), req.file.buffer);

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) m FROM candidates').get().m;
  db.prepare('INSERT INTO candidates (id, name, photo, position, active) VALUES (?, ?, ?, ?, 1)').run(
    id,
    name,
    filename,
    maxPos + 1
  );

  reloadCandidatesCache();
  if (!tally.has(id)) tally.set(id, 0);
  console.log(`[admin] Candidate added: ${id} (${name}) by ${getClientIp(req)}`);
  res.json({ success: true, id });
});

app.put('/api/admin/candidates/:id', requireAdminAuth, upload.single('photo'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const name = req.body.name && req.body.name.trim() ? req.body.name.trim() : existing.name;

  let active = existing.active;
  if (typeof req.body.active !== 'undefined') {
    active = req.body.active === 'true' || req.body.active === '1' ? 1 : 0;
  }

  let position = existing.position;
  if (typeof req.body.position !== 'undefined' && !Number.isNaN(Number(req.body.position))) {
    position = Number(req.body.position);
  }

  let photo = existing.photo;
  if (req.file) {
    const filename = `${id}${extFromMime(req.file.mimetype)}`;
    fs.writeFileSync(path.join(CANDIDATE_IMAGES_DIR, filename), req.file.buffer);
    if (filename !== existing.photo) {
      const oldPath = path.join(CANDIDATE_IMAGES_DIR, existing.photo);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }
    photo = filename;
  }

  db.prepare('UPDATE candidates SET name = ?, photo = ?, position = ?, active = ? WHERE id = ?').run(
    name,
    photo,
    position,
    active,
    id
  );

  reloadCandidatesCache();
  console.log(`[admin] Candidate updated: ${id} by ${getClientIp(req)}`);
  res.json({ success: true });
});

app.delete('/api/admin/candidates/:id', requireAdminAuth, (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
  // Vote history for this id is kept (tally + votes table) so past results
  // stay accurate; only the photo file is removed since it's no longer
  // shown anywhere.
  const photoPath = path.join(CANDIDATE_IMAGES_DIR, existing.photo);
  if (fs.existsSync(photoPath)) {
    try { fs.unlinkSync(photoPath); } catch (_) {}
  }

  reloadCandidatesCache();
  console.log(`[admin] Candidate deleted: ${id} by ${getClientIp(req)}`);
  res.json({ success: true });
});

// --- QR vote tokens: generate / list / export / delete ---

// Generates a single QR PNG for a given token (reused by both the admin
// thumbnail preview and the ZIP export below, so there's one code path).
async function qrPngBuffer(url) {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: 512,
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// Generates PNG buffers for a whole batch of tokens with bounded
// concurrency, instead of one-at-a-time. A large batch (e.g. 650+ tokens)
// awaited sequentially can take long enough to blow past a reverse proxy's
// upstream timeout, producing a 502 to the client even though the request
// eventually succeeds server-side - this cuts that wall-clock time down
// roughly by the concurrency factor while still capping how many QR encodes
// run at once (unlike an unbounded Promise.all over every token).
async function qrPngBuffersForTokens(req, tokens, concurrency = 20) {
  const buffers = new Array(tokens.length);
  let next = 0;
  async function worker() {
    while (next < tokens.length) {
      const i = next++;
      buffers[i] = await qrPngBuffer(voteUrl(req, tokens[i]));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tokens.length) }, worker)
  );
  return buffers;
}

app.post('/api/admin/tokens/generate', requireAdminAuth, (req, res) => {
  const count = Math.floor(Number(req.body && req.body.count));
  const label = ((req.body && req.body.label) || '').trim() || null;

  if (!Number.isFinite(count) || count < 1 || count > 20000) {
    return res.status(400).json({ error: 'invalid_count' });
  }

  const now = new Date().toISOString();
  const batchInfo = db
    .prepare('INSERT INTO token_batches (label, count, created_at) VALUES (?, ?, ?)')
    .run(label, count, now);
  const batchId = batchInfo.lastInsertRowid;

  const insertToken = db.prepare(
    'INSERT INTO vote_tokens (token, batch_id, used, created_at) VALUES (?, ?, 0, ?)'
  );
  const insertMany = db.transaction((tokens) => {
    for (const t of tokens) insertToken.run(t, batchId, now);
  });

  // Generate `count` unique tokens, retrying on the (astronomically rare)
  // chance of a collision with an existing one.
  const tokens = [];
  const seen = new Set();
  while (tokens.length < count) {
    const t = generateToken();
    if (seen.has(t) || tokenMeta.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  insertMany(tokens);

  for (const t of tokens) {
    tokenMeta.set(t, { batchId, used: false, candidate: null, usedAt: null });
  }

  console.log(`[admin] Generated ${count} QR token(s) (batch #${batchId}, "${label || ''}") by ${getClientIp(req)}`);
  res.json({ success: true, batchId, count, label });
});

app.get('/api/admin/tokens/batches', requireAdminAuth, (req, res) => {
  const batches = db.prepare('SELECT id, label, count, created_at FROM token_batches ORDER BY id DESC').all();

  // Both counts come from the in-memory tokenMeta (the real-time source of
  // truth), not the DB: token-usage updates are only queued in memory and
  // flushed every 2s (so a DB read could show stale "used" counts), and
  // individual tokens can be deleted one at a time (see DELETE
  // /api/admin/tokens/:token below), which would make the original
  // token_batches.count column drift from the actual remaining total.
  const totalMap = new Map();
  const usedMap = new Map();
  for (const meta of tokenMeta.values()) {
    totalMap.set(meta.batchId, (totalMap.get(meta.batchId) || 0) + 1);
    if (meta.used) usedMap.set(meta.batchId, (usedMap.get(meta.batchId) || 0) + 1);
  }

  res.json(
    batches.map((b) => ({
      id: b.id,
      label: b.label,
      count: totalMap.get(b.id) || 0,
      used: usedMap.get(b.id) || 0,
      createdAt: b.created_at,
    }))
  );
});

app.get('/api/admin/tokens/batches/:id/tokens', requireAdminAuth, (req, res) => {
  const batchId = Number(req.params.id);
  const rows = db
    .prepare('SELECT token FROM vote_tokens WHERE batch_id = ? ORDER BY rowid ASC')
    .all(batchId);
  res.json(
    rows.map((r) => {
      const meta = tokenMeta.get(r.token) || { used: false, candidate: null, usedAt: null };
      return {
        token: r.token,
        used: meta.used,
        candidate: meta.candidate,
        used_at: meta.usedAt,
        url: voteUrl(req, r.token),
      };
    })
  );
});

app.get('/api/admin/tokens/:token/qr.png', requireAdminAuth, async (req, res) => {
  try {
    const buf = await qrPngBuffer(voteUrl(req, req.params.token));
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable'); // a token's QR content never changes
    res.send(buf);
  } catch (err) {
    console.error('QR generation failed:', err);
    res.status(500).json({ error: 'qr_generation_failed' });
  }
});

app.get('/api/admin/tokens/batches/:id/csv', requireAdminAuth, (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare('SELECT * FROM token_batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'not_found' });

  const rows = db
    .prepare('SELECT token FROM vote_tokens WHERE batch_id = ? ORDER BY rowid ASC')
    .all(batchId);

  const csvLines = ['token,url,used,candidate,used_at'];
  for (const r of rows) {
    const meta = tokenMeta.get(r.token) || { used: false, candidate: null, usedAt: null };
    csvLines.push(
      [r.token, voteUrl(req, r.token), meta.used ? '1' : '0', meta.candidate || '', meta.usedAt || '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
  }

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="qr-tokens-batch-${batchId}.csv"`);
  res.send(csvLines.join('\n'));
});

app.get('/api/admin/tokens/batches/:id/zip', requireAdminAuth, async (req, res) => {
  try {
    const batchId = Number(req.params.id);
    const batch = db.prepare('SELECT * FROM token_batches WHERE id = ?').get(batchId);
    if (!batch) return res.status(404).json({ error: 'not_found' });

    const rows = db.prepare('SELECT token FROM vote_tokens WHERE batch_id = ? ORDER BY rowid ASC').all(batchId);
    const tokens = rows.map((r) => r.token);
    // Generate every QR PNG up front (bounded concurrency) before writing
    // anything to the response, so a slow/large batch doesn't sit there
    // trickling bytes while a client-side timeout (e.g. a reverse proxy)
    // gives up and disconnects mid-stream.
    const buffers = await qrPngBuffersForTokens(req, tokens);

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="qr-tokens-batch-${batchId}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('ZIP generation failed:', err);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    // Without this, a client that already disconnected (e.g. after a proxy
    // timeout) causes an unhandled 'error' event on the response stream
    // when we try to keep writing to it - which crashes the whole process,
    // not just this request.
    res.on('error', (err) => {
      console.error('ZIP response stream error (client likely disconnected):', err.message);
    });
    archive.pipe(res);

    const pad = String(tokens.length).length;
    tokens.forEach((token, i) => {
      const seq = String(i + 1).padStart(pad, '0');
      archive.append(buffers[i], { name: `${seq}-${token}.png` });
    });

    await archive.finalize();
  } catch (err) {
    console.error('ZIP generation failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'zip_generation_failed' });
    else res.end();
  }
});

// Printable PDF sheet of every QR in a batch, laid out 3 per row so it can
// be cut up and handed out. Layout mirrors the ZIP export's data (one QR
// per token) but is meant for printing rather than distribution as files.
app.get('/api/admin/tokens/batches/:id/pdf', requireAdminAuth, async (req, res) => {
  try {
    const batchId = Number(req.params.id);
    const batch = db.prepare('SELECT * FROM token_batches WHERE id = ?').get(batchId);
    if (!batch) return res.status(404).json({ error: 'not_found' });

    const rows = db.prepare('SELECT token FROM vote_tokens WHERE batch_id = ? ORDER BY rowid ASC').all(batchId);
    const tokens = rows.map((r) => r.token);
    // Generate every QR PNG up front (bounded concurrency) before writing
    // anything to the response - see qrPngBuffersForTokens for why.
    const buffers = await qrPngBuffersForTokens(req, tokens);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="qr-tokens-batch-${batchId}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    doc.on('error', (err) => {
      console.error('PDF generation failed:', err);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    // Without this, a client that already disconnected (e.g. after a proxy
    // timeout) causes an unhandled 'error' event on the response stream
    // when we try to keep writing to it - which crashes the whole process,
    // not just this request.
    res.on('error', (err) => {
      console.error('PDF response stream error (client likely disconnected):', err.message);
    });
    doc.pipe(res);

    const COLS = 4;
    const rowsPerPage = 5;
    // Tighter gaps than before so the QR itself gets to be bigger within the
    // same fixed 4x5 grid: GAP_X is the horizontal gap between columns,
    // GAP_Y the vertical gap between rows (kept a bit larger than GAP_X so
    // rows don't feel cramped against each other's labels).
    const GAP_X = 10;
    const GAP_Y = 16;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cellWidth = (usableWidth - GAP_X * (COLS - 1)) / COLS;
    const qrSize = cellWidth - 8;
    const labelHeight = 14;
    const cellHeight = qrSize + labelHeight + GAP_Y;

    const title = `QR de vote — Lot #${batchId}${batch.label ? ` · ${batch.label}` : ''}`;
    doc.fontSize(14).text(title, { align: 'left' });
    doc.moveDown(0.5);
    let gridTop = doc.y;

    for (let i = 0; i < tokens.length; i++) {
      const col = i % COLS;
      const rowInPage = Math.floor((i % (rowsPerPage * COLS)) / COLS);

      if (i > 0 && i % (rowsPerPage * COLS) === 0) {
        doc.addPage();
        gridTop = doc.page.margins.top;
      }

      const x = doc.page.margins.left + col * (cellWidth + GAP_X);
      const y = gridTop + rowInPage * cellHeight;

      doc.image(buffers[i], x + (cellWidth - qrSize) / 2, y, { width: qrSize, height: qrSize });
      // doc.fontSize(8).text(tokens[i], x, y + qrSize + 8, { width: cellWidth, align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'pdf_generation_failed' });
    else res.end();
  }
});

app.delete('/api/admin/tokens/batches/:id', requireAdminAuth, (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare('SELECT * FROM token_batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'not_found' });

  let usedCount = 0;
  for (const meta of tokenMeta.values()) {
    if (meta.batchId === batchId && meta.used) usedCount++;
  }
  if (usedCount > 0) {
    return res.status(409).json({ error: 'batch_has_used_tokens', used: usedCount });
  }

  const tokensToRemove = db.prepare('SELECT token FROM vote_tokens WHERE batch_id = ?').all(batchId);
  db.prepare('DELETE FROM vote_tokens WHERE batch_id = ?').run(batchId);
  db.prepare('DELETE FROM token_batches WHERE id = ?').run(batchId);
  for (const r of tokensToRemove) tokenMeta.delete(r.token);

  console.log(`[admin] Deleted QR token batch #${batchId} by ${getClientIp(req)}`);
  res.json({ success: true });
});

// Deletes a single unused QR token (as opposed to the whole batch above).
// Used tokens can't be deleted - same audit-trail reasoning as the batch
// delete: once a token cast a vote it stays as a record of that.
app.delete('/api/admin/tokens/:token', requireAdminAuth, (req, res) => {
  const token = req.params.token;
  const existing = db.prepare('SELECT * FROM vote_tokens WHERE token = ?').get(token);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const meta = tokenMeta.get(token);
  if (meta && meta.used) {
    return res.status(409).json({ error: 'token_already_used' });
  }

  db.prepare('DELETE FROM vote_tokens WHERE token = ?').run(token);
  tokenMeta.delete(token);
  pendingTokenUpdates.delete(token);

  console.log(`[admin] Deleted QR token ${token} (batch #${existing.batch_id}) by ${getClientIp(req)}`);
  res.json({ success: true });
});

// Friendlier error for oversized/invalid file uploads instead of a raw 500.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'invalid_file_type') {
    return res.status(400).json({ error: err.code || err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => {
  console.log(`La Coupe d'Humour server running on http://localhost:${PORT}`);
});
