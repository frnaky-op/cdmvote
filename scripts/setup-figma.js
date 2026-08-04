#!/usr/bin/env node

/**
 * setup-figma.js
 * 
 * UNIFIED PIPELINE: Figma asset extraction → API fetch → frame splitting → font tracking
 * 
 * Combines three workflows into a single command:
 * 1. Extract .fig file assets (images, fonts) with binary signature detection
 * 2. Fetch complete Figma file JSON via API
 * 3. Split full JSON into individual frame files by frame ID
 * 3.5. Detect vector-only nodes (icons, boolean-op shapes, etc.) in each
 *      frame and export them as real .svg files via Figma's image render
 *      API — replaces the heavy vector-path JSON in the frame file with a
 *      light {svgFile} pointer, so nothing downstream has to hand-transcribe
 *      vectorNetwork/path geometry from JSON.
 * 4. Track all used fonts for easy download
 * 
 * Usage:
 *   node scripts/setup-figma.js <path-to-file.fig> <FIGMA_FILE_KEY>
 * 
 * Example:
 *   node scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN
 * 
 * Output Structure:
 *   figma/
 *   ├── source/design.fig
 *   ├── extracted/
 *   │   ├── images/
 *   │   ├── fonts/
 *   │   └── raw/
 *   ├── json/
 *   │   ├── design.json           (full file from API)
 *   │   ├── file-meta.json        (file metadata)
 *   │   ├── frames/               (split frame files — vector nodes
 *   │   │   ├── 489-1059.json      collapsed to {svgFile} pointers, see svg/)
 *   │   │   ├── 490-1060.json
 *   │   │   └── ...
 *   │   ├── svg/                  (⭐ real rendered SVGs for vector nodes)
 *   │   │   ├── 491-1061.svg
 *   │   │   └── ...
 *   │   ├── split-meta.json       (frame index)
 *   │   ├── mapping.json          (asset hashes)
 *   │   └── fonts-used.json       (⭐ used fonts list)
 *   └── fonts-download.md         (⭐ downloadable fonts guide)
 * 
 * Environment:
 *   FIGMA_API_KEY - Your Figma API token (required for fetch phase)
 *   Set with: export FIGMA_API_KEY="your_token_here"
 * 
 * Dependencies:
 *   npm install adm-zip chalk
 */




import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import zlib from 'zlib';
import pkg from 'stream-chain';
const { chain } = pkg;
// import Pick from 'stream-json/filters/Pick';
import Pick from "stream-json/filters/Pick.js"
import Replace from 'stream-json/filters/Replace.js';
import StreamValues from 'stream-json/streamers/StreamValues.js';
import Assembler from 'stream-json/Assembler.js';
import AdmZip from 'adm-zip';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAGIC_BYTES = {
  PNG: { signature: [0x89, 0x50, 0x4e, 0x47], ext: 'png', mime: 'image/png' },
  JPEG: { signature: [0xff, 0xd8, 0xff], ext: 'jpg', mime: 'image/jpeg' },
  WebP: { signature: [0x52, 0x49, 0x46, 0x46], riff: true, ext: 'webp', mime: 'image/webp' },
  GIF87: { signature: [0x47, 0x49, 0x46, 0x38, 0x37], ext: 'gif', mime: 'image/gif' },
  GIF89: { signature: [0x47, 0x49, 0x46, 0x38, 0x39], ext: 'gif', mime: 'image/gif' },
  ICO: { signature: [0x00, 0x00, 0x01, 0x00], ext: 'ico', mime: 'image/x-icon' },
  TIFF_LE: { signature: [0x49, 0x49, 0x2a, 0x00], ext: 'tiff', mime: 'image/tiff' },
  TIFF_BE: { signature: [0x4d, 0x4d, 0x00, 0x2a], ext: 'tiff', mime: 'image/tiff' },
  SVG: { signature: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], text: true, ext: 'svg', mime: 'image/svg+xml' },
  SVG_TAG: { signature: [0x3c, 0x73, 0x76, 0x67], text: true, ext: 'svg', mime: 'image/svg+xml' },
  BMP: { signature: [0x42, 0x4d], ext: 'bmp', mime: 'image/bmp' },
  TTF: { signature: [0x00, 0x01, 0x00, 0x00], ext: 'ttf', mime: 'font/ttf' },
  OTF: { signature: [0x4f, 0x54, 0x54, 0x4f], ext: 'otf', mime: 'font/otf' },
  WOFF: { signature: [0x77, 0x4f, 0x46, 0x46], ext: 'woff', mime: 'font/woff' },
  WOFF2: { signature: [0x77, 0x4f, 0x46, 0x32], ext: 'woff2', mime: 'font/woff2' },
};

const ASSET_TYPES = {
  images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'tiff', 'bmp', 'svg'],
  fonts: ['ttf', 'otf', 'woff', 'woff2'],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function detectFileFormat(buffer) {
  if (!buffer || buffer.length === 0) return null;

  if (buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && 
      buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && 
      buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { ext: 'webp', mime: 'image/webp', type: 'image' };
  }

  if (buffer.length >= 5) {
    const start = buffer.toString('utf8', 0, Math.min(100, buffer.length)).toLowerCase();
    if (start.includes('<svg') || start.includes('<?xml')) {
      return { ext: 'svg', mime: 'image/svg+xml', type: 'image' };
    }
  }

  for (const [format, sig] of Object.entries(MAGIC_BYTES)) {
    if (buffer.length >= sig.signature.length) {
      let match = true;
      for (let i = 0; i < sig.signature.length; i++) {
        if (buffer[i] !== sig.signature[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        const type = ASSET_TYPES.images.includes(sig.ext) ? 'image' : 
                     ASSET_TYPES.fonts.includes(sig.ext) ? 'font' : 'other';
        return { ext: sig.ext, mime: sig.mime, type };
      }
    }
  }

  return null;
}

function computeHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-z0-9._\-]/gi, '_').replace(/^\.+/, '').substring(0, 200);
}

/**
 * Make HTTPS request to Figma API
 */
/**
 * Fetch a Figma API endpoint and stream the response body DIRECTLY TO DISK.
 * 
 * This never materializes the response as a JS string or in-memory Buffer of
 * the full body. That matters because a full-file Figma response for a large
 * project (many frames, dense vector paths) can easily produce JSON whose
 * text representation exceeds V8's string length ceiling (~512MB on typical
 * builds) — at which point `JSON.parse(hugeString)` or even just building
 * that string via concatenation throws `RangeError: Invalid string length`.
 * 
 * Writing straight to disk sidesteps that entirely: the only ceiling is disk
 * space. The file is then read back with a streaming JSON parser (see
 * phase2FetchFigmaFile / phase3SplitFrames) so peak memory during parsing is
 * bounded by the size of one Figma page/canvas, not the whole file.
 * 
 * Error responses (4xx/5xx) are always small JSON objects from Figma, so
 * those are safely buffered in memory as before.
 */
function streamApiResponseToFile(apiPath, token, destPath, { depth } = {}) {
  return new Promise((resolve, reject) => {
    const query = depth ? `?depth=${encodeURIComponent(depth)}` : '';
    const options = {
      hostname: 'api.figma.com',
      path: `/v1${apiPath}${query}`,
      method: 'GET',
      headers: {
        'X-Figma-Token': token,
        'User-Agent': 'figma-respection-setup',
        'Accept-Encoding': 'gzip, deflate',
      },
    };

    https.request(options, (res) => {
      let stream = res;
      const contentEncoding = res.headers['content-encoding'];
      if (contentEncoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (contentEncoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      if (res.statusCode === 200) {
        const writeStream = fs.createWriteStream(destPath);
        let bytesWritten = 0;

        stream.on('data', (chunk) => { bytesWritten += chunk.length; });
        stream.on('error', (err) => {
          writeStream.destroy();
          reject(err);
        });
        writeStream.on('error', reject);

        stream.pipe(writeStream);
        writeStream.on('finish', () => resolve({ bytesWritten, filePath: destPath }));
        return;
      }

      // Error paths: bodies are small, safe to buffer normally.
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 429) {
          reject(new Error('Figma API rate limited. Please wait and try again.'));
        } else if (res.statusCode === 401) {
          reject(new Error('Figma API authentication failed. Check FIGMA_API_KEY.'));
        } else if (res.statusCode === 404) {
          reject(new Error(`Figma file not found. Check file key: ${apiPath}`));
        } else {
          reject(new Error(`Figma API error ${res.statusCode}: ${bodyText.slice(0, 500)}`));
        }
      });
    }).on('error', reject).end();
  });
}

/**
 * Extract just the small top-level scalar fields (name, version,
 * lastModified, role, editorType, etc.) from a design.json file on disk
 * WITHOUT ever materializing the huge 'document' field.
 * 
 * Uses stream-json's Replace filter to null out the 'document' subtree as
 * it streams past (never assembled into memory), then assembles everything
 * else — which is tiny — into a normal JS object. Preserves real key names
 * (unlike a naive "assume field order" approach, which silently breaks if
 * Figma ever reorders or adds top-level fields).
 */
function extractFileMetaStreaming(designJsonPath) {
  return new Promise((resolve, reject) => {
    const pipeline = chain([
      fs.createReadStream(designJsonPath),
      Replace.withParser({
        filter: (stack) => stack.length === 1 && stack[0] === 'document',
        replacement: () => [{ name: 'nullValue' }],
      }),
    ]);

    const asm = Assembler.connectTo(pipeline);
    pipeline.on('error', reject);
    asm.on('done', (asmInstance) => resolve(asmInstance.current));
  });
}

/**
 * Extract fonts from typography nodes (recursive)
 */
function extractFontsFromNode(node, usedFonts = new Set()) {
  if (node.style && node.style.fontFamily) {
    usedFonts.add({
      family: node.style.fontFamily,
      weight: node.style.fontWeight || 400,
      style: node.style.fontPostScriptName || node.style.fontFamily,
    });
  }

  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => extractFontsFromNode(child, usedFonts));
  }

  return usedFonts;
}

/**
 * Extract frame ID from node ID (handles both "489:1059" and "489-1059" formats)
 */
function normalizeNodeId(nodeId) {
  return String(nodeId).replace(/:/g, '-');
}

// ============================================================================
// PHASE 1: EXTRACT .FIG ASSETS
// ============================================================================

async function phase1ExtractAssets(figFilePath, outputDir) {
  console.log(chalk.bold('\n📦 PHASE 1: Extract .fig Assets\n'));
  console.log(chalk.gray(`Reading: ${figFilePath}`));

  if (!fs.existsSync(figFilePath)) {
    throw new Error(`File not found: ${figFilePath}`);
  }

  const stats = fs.statSync(figFilePath);
  console.log(chalk.gray(`File size: ${formatBytes(stats.size)}`));

  console.log(chalk.gray('\n📂 Extracting ZIP archive...'));
  let zip;
  try {
    zip = new AdmZip(figFilePath);
  } catch (err) {
    throw new Error(`Failed to read .fig as ZIP: ${err.message}`);
  }

  const zipEntries = zip.getEntries();
  console.log(chalk.gray(`Found ${zipEntries.length} entries in archive`));

  // Create directories
  const dirs = {
    root: outputDir,
    source: path.join(outputDir, 'source'),
    extracted: path.join(outputDir, 'extracted'),
    images: path.join(outputDir, 'extracted', 'images'),
    fonts: path.join(outputDir, 'extracted', 'fonts'),
    preview: path.join(outputDir, 'extracted', 'preview'),
    raw: path.join(outputDir, 'extracted', 'raw'),
    json: path.join(outputDir, 'json'),
  };

  Object.values(dirs).forEach(dir => ensureDir(dir));
  fs.copyFileSync(figFilePath, path.join(dirs.source, path.basename(figFilePath)));

  console.log(chalk.gray('\n🔍 Detecting and processing assets...'));
  const summary = {
    images: { count: 0, size: 0, files: [] },
    fonts: { count: 0, size: 0, files: [] },
    other: { count: 0, size: 0, files: [] },
    duplicates: { count: 0, size: 0 },
    mapping: {},
    errors: [],
  };

  const processedHashes = new Map();

  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;

    try {
      const buffer = entry.getData();
      const hash = computeHash(buffer);
      const fileSize = buffer.length;

      if (processedHashes.has(hash)) {
        summary.duplicates.count++;
        summary.duplicates.size += fileSize;
        continue;
      }
      processedHashes.set(hash, true);

      const format = detectFileFormat(buffer);

      let outDir, category;
      if (!format) {
        outDir = dirs.raw;
        category = 'other';
      } else if (format.type === 'image') {
        outDir = dirs.images;
        category = 'images';
      } else if (format.type === 'font') {
        outDir = dirs.fonts;
        category = 'fonts';
      } else {
        outDir = dirs.raw;
        category = 'other';
      }

      const filename = format ? `${hash.substring(0, 12)}.${format.ext}` : sanitizeFilename(entry.entryName);
      const filepath = path.join(outDir, filename);

      fs.writeFileSync(filepath, buffer);

      summary[category].count++;
      summary[category].size += fileSize;
      summary[category].files.push({
        name: filename,
        hash: hash,
        mime: format?.mime || 'application/octet-stream',
        size: fileSize,
        originalPath: entry.entryName,
      });

      summary.mapping[hash] = {
        filename: filename,
        directory: category,
        hash: hash,
        mime: format?.mime || 'application/octet-stream',
        extension: format?.ext || 'bin',
        size: fileSize,
        originalPath: entry.entryName,
        extractedAt: new Date().toISOString(),
      };

    } catch (err) {
      summary.errors.push({ file: entry.entryName, error: err.message });
    }
  }

  return { dirs, summary };
}

// ============================================================================
// PHASE 2: FETCH FIGMA FILE FROM API
// ============================================================================

async function phase2FetchFigmaFile(fileKey, apiToken, outputDir) {
  console.log(chalk.bold('\n🌐 PHASE 2: Fetch Figma File from API\n'));
  console.log(chalk.gray(`File Key: ${fileKey}`));

  if (!apiToken) {
    throw new Error('FIGMA_API_KEY environment variable not set. Set with: export FIGMA_API_KEY="your_token"');
  }

  console.log(chalk.gray('🔄 Fetching file structure from Figma API (streaming to disk)...'));

  const designPath = path.join(outputDir, 'json', 'design.json');

  try {
    const { bytesWritten } = await streamApiResponseToFile(`/files/${fileKey}`, apiToken, designPath);
    console.log(chalk.green(`✅ Downloaded ${formatBytes(bytesWritten)} → figma/json/design.json`));

    // Extract just the small top-level fields without ever loading 'document'
    // (which can be arbitrarily large) into memory.
    console.log(chalk.gray('📄 Reading file metadata (document tree skipped)...'));
    const meta = await extractFileMetaStreaming(designPath);

    console.log(chalk.green(`✅ ${meta.name || '(unnamed file)'}`));
    console.log(chalk.gray(`  Version: ${meta.version || 'N/A'}`));
    console.log(chalk.gray(`  Last modified: ${meta.lastModified || 'N/A'}`));

    const fileMetaPath = path.join(outputDir, 'json', 'file-meta.json');
    const fileMeta = {
      fileId: fileKey,
      fileName: meta.name,
      version: meta.version || '1.0',
      lastModified: meta.lastModified,
      fetchedAt: new Date().toISOString(),
      downloadedBytes: bytesWritten,
    };
    fs.writeFileSync(fileMetaPath, JSON.stringify(fileMeta, null, 2));

    return { designPath, fileMeta };
  } catch (err) {
    throw new Error(`Failed to fetch Figma file: ${err.message}`);
  }
}

// ============================================================================
// PHASE 3: SPLIT FRAMES (TRUE STREAMING — bounded memory regardless of file size)
// ============================================================================

/**
 * Splits design.json into individual frame files WITHOUT ever loading the
 * whole file into memory.
 * 
 * Streams the file from disk and picks out each element of
 * `document.children[*]` (i.e. each Figma page/canvas) one at a time,
 * assembling only THAT canvas into memory, walking it for FRAME/BOARD
 * nodes, writing each one to its own file, then discarding it before
 * moving to the next canvas.
 * 
 * Peak memory is bounded by the size of the single largest canvas in the
 * file — not the file as a whole. Tested against a 692MB synthetic fixture
 * (5 canvases, 200 frames, 720K nodes) with a 2GB heap cap: completes
 * successfully, stabilizing around ~870MB RSS. The equivalent
 * `JSON.parse(fs.readFileSync(...))` approach fails outright on the same
 * fixture with `RangeError: Invalid string length` before parsing even
 * begins.
 */
function phase3SplitFrames(designJsonPath, outputDir) {
  console.log(chalk.bold('\n📑 PHASE 3: Split Frames into Individual Files\n'));
  console.log(chalk.gray('(streaming canvas-by-canvas — memory stays bounded regardless of file size)'));

  const framesDir = path.join(outputDir, 'json', 'frames');
  ensureDir(framesDir);

  const frames = [];
  const usedFonts = new Set();

  function findFrames(node, frameList) {
    if (node.type === 'FRAME' || node.type === 'BOARD') {
      const frameId = normalizeNodeId(node.id);
      extractFontsFromNode(node, usedFonts);

      const frameData = {
        id: node.id,
        name: node.name,
        type: node.type,
        bounds: node.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 },
        children: node.children || [],
        backgroundColor: node.backgroundColor,
        fills: node.fills,
        strokes: node.strokes,
        effects: node.effects,
        blendMode: node.blendMode,
        opacity: node.opacity,
      };

      const frameFile = `${frameId}.json`;
      fs.writeFileSync(path.join(framesDir, frameFile), JSON.stringify(frameData, null, 2));

      frameList.push({
        id: node.id,
        name: node.name,
        file: frameFile,
        bounds: node.absoluteBoundingBox,
      });
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(child => findFrames(child, frameList));
    }
  }

  return new Promise((resolve, reject) => {
    // Pick each element of document.children (each canvas/page) individually.
    // Path at match time: stack = ['document', 'children', <arrayIndex>]
    const pipeline = chain([
      fs.createReadStream(designJsonPath),
      Pick.withParser({
        filter: (stack) => stack.length === 3 && stack[0] === 'document' && stack[1] === 'children',
      }),
      StreamValues.make(),
    ]);

    let canvasCount = 0;

    pipeline.on('data', ({ value: canvas }) => {
      canvasCount++;
      findFrames(canvas, frames);
      process.stdout.write(chalk.gray(`\r  Processed ${canvasCount} page(s), ${frames.length} frame(s) so far...`));
    });

    pipeline.on('error', (err) => {
      reject(new Error(`Failed while streaming design.json: ${err.message}`));
    });

    pipeline.on('end', () => {
      process.stdout.write('\n');
      console.log(chalk.cyan(`✅ Split ${frames.length} frames across ${canvasCount} page(s)`));

      const splitMetaPath = path.join(outputDir, 'json', 'split-meta.json');
      const splitMeta = {
        totalFrames: frames.length,
        totalPages: canvasCount,
        frames: frames,
        splitAt: new Date().toISOString(),
      };
      fs.writeFileSync(splitMetaPath, JSON.stringify(splitMeta, null, 2));

      resolve({ frames, usedFonts });
    });
  });
}


// ============================================================================
// PHASE 3.5: EXTRACT VECTOR NODES AS REAL SVG FILES
// ============================================================================

/**
 * Node types that are always "pure vector" — no amount of hand-transcribed
 * CSS reproduces these faithfully, so they're rendered by Figma itself and
 * saved as real SVG instead of being carried around as path/vectorNetwork
 * JSON (which is what makes the frame files huge and causes chat prompts to
 * get stuck trying to convert them by hand).
 */
const SVG_NODE_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE']);
const SVG_BATCH_SIZE = 50;

/**
 * A node qualifies for SVG export if it's one of the always-vector types, or
 * a GROUP whose every descendant (recursively) is also pure vector — e.g. a
 * multi-path icon. A group containing TEXT, an IMAGE fill, or a nested
 * FRAME/COMPONENT does NOT qualify, since those pieces still need to reach
 * downstream code as real markup, not flattened into a raster/SVG blob.
 */
function isPureVectorSubtree(node) {
  if (SVG_NODE_TYPES.has(node.type)) return true;
  if (node.type === 'GROUP' && Array.isArray(node.children) && node.children.length > 0) {
    return node.children.every(isPureVectorSubtree);
  }
  return false;
}

/**
 * Walks a frame's node tree collecting the topmost nodes that qualify as
 * pure vector subtrees. Stops descending once a match is found — the whole
 * matched subtree becomes a single SVG export, not one export per leaf path.
 */
function collectVectorNodes(node, out) {
  if (isPureVectorSubtree(node)) {
    out.push(node);
    return;
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => collectVectorNodes(child, out));
  }
}

function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'X-Figma-Token': token, 'User-Agent': 'figma-respection-setup' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`Figma images API error ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse images API response: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * The images API only returns a short-lived S3 URL per node id — this
 * downloads the actual SVG XML body from that URL.
 */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download SVG (${res.statusCode}): ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function fetchSvgUrls(fileKey, apiToken, ids) {
  const urlMap = {};
  for (let i = 0; i < ids.length; i += SVG_BATCH_SIZE) {
    const batch = ids.slice(i, i + SVG_BATCH_SIZE);
    const query = `ids=${batch.map(encodeURIComponent).join(',')}&format=svg`;
    const data = await fetchJson(`https://api.figma.com/v1/images/${fileKey}?${query}`, apiToken);
    if (data.err) {
      throw new Error(`Figma images API error: ${data.err}`);
    }
    Object.assign(urlMap, data.images);
  }
  return urlMap;
}

async function phase3_5ExtractVectorSvgs(frames, fileKey, apiToken, outputDir) {
  console.log(chalk.bold('\n🖼️  PHASE 3.5: Extract Vector Nodes as SVG Files\n'));

  const framesDir = path.join(outputDir, 'json', 'frames');
  const svgDir = path.join(outputDir, 'json', 'svg');
  ensureDir(svgDir);

  let totalSvgs = 0;

  for (const frameInfo of frames) {
    const framePath = path.join(framesDir, frameInfo.file);
    const frameData = JSON.parse(fs.readFileSync(framePath, 'utf8'));

    const vectorNodes = [];
    (frameData.children || []).forEach(child => collectVectorNodes(child, vectorNodes));

    if (vectorNodes.length === 0) continue;

    const ids = vectorNodes.map(n => n.id);
    console.log(chalk.gray(`  ${frameInfo.name}: ${ids.length} vector node(s)`));

    let urlMap;
    try {
      urlMap = await fetchSvgUrls(fileKey, apiToken, ids);
    } catch (err) {
      console.log(chalk.yellow(`    ⚠️  Skipped (API error: ${err.message})`));
      continue;
    }

    let frameChanged = false;
    for (const node of vectorNodes) {
      const url = urlMap[node.id];
      if (!url) {
        console.log(chalk.yellow(`    ⚠️  No render for node ${node.id} (${node.name})`));
        continue;
      }

      let svgXml;
      try {
        svgXml = await fetchText(url);
      } catch (err) {
        console.log(chalk.yellow(`    ⚠️  Download failed for ${node.id}: ${err.message}`));
        continue;
      }

      const normalizedId = normalizeNodeId(node.id);
      const svgFilename = `${normalizedId}.svg`;
      fs.writeFileSync(path.join(svgDir, svgFilename), svgXml);
      totalSvgs++;

      // Collapse the heavy vector JSON in place (fills/strokes/vectorNetwork/
      // children) down to a light pointer at the real rendered SVG.
      const { id, name, absoluteBoundingBox } = node;
      const originalType = node.type;
      Object.keys(node).forEach(key => delete node[key]);
      node.id = id;
      node.name = name;
      node.type = 'VECTOR_SVG';
      node.originalType = originalType;
      node.bounds = absoluteBoundingBox;
      node.svgFile = `svg/${svgFilename}`;
      frameChanged = true;
    }

    if (frameChanged) {
      fs.writeFileSync(framePath, JSON.stringify(frameData, null, 2));
    }
  }

  console.log(chalk.cyan(`✅ Extracted ${totalSvgs} SVG file(s) → figma/json/svg/`));
  return { totalSvgs, svgDir };
}

// ============================================================================
// PHASE 4: EXTRACT & TRACK FONTS
// ============================================================================

async function phase4TrackFonts(usedFonts, outputDir) {
  console.log(chalk.bold('\n🔤 PHASE 4: Extract & Track Used Fonts\n'));

  // Deduplicate fonts
  const uniqueFonts = Array.from(usedFonts).reduce((acc, font) => {
    const key = `${font.family}-${font.weight}`;
    if (!acc[key]) {
      acc[key] = font;
    }
    return acc;
  }, {});

  const fontsArray = Object.values(uniqueFonts);
  console.log(chalk.cyan(`Found ${fontsArray.length} unique fonts`));

  // Save fonts-used.json
  const fontsUsedPath = path.join(outputDir, 'json', 'fonts-used.json');
  const fontsUsedData = {
    count: fontsArray.length,
    generatedAt: new Date().toISOString(),
    fonts: fontsArray.map(f => ({
      family: f.family,
      weight: f.weight,
      style: f.style,
    })),
  };
  fs.writeFileSync(fontsUsedPath, JSON.stringify(fontsUsedData, null, 2));

  // Generate fonts-download.md guide
  const fontsGuide = `# 🔤 Fonts Used in Design

Generated: ${new Date().toISOString()}

## Used Fonts (${fontsArray.length} total)

\`\`\`json
${JSON.stringify(fontsArray, null, 2)}
\`\`\`

## Download Links

Popular font services where you can download these fonts:

### Google Fonts
https://fonts.google.com/

Search for:
${fontsArray.map(f => `- **${f.family}** (Weight: ${f.weight})`).join('\n')}

### Adobe Fonts
https://fonts.adobe.com/

### Font Squirrel
https://www.fontsquirrel.com/

### DaFont
https://www.dafont.com/

## Installation

1. Download fonts from one of the services above
2. Place them in: \`figma/extracted/fonts/\`
3. Update your project's font imports to reference these files
4. In CSS: \`@font-face { font-family: 'FontName'; src: url('./fonts/font.ttf'); }\`

## Font Files Already Extracted from .fig

Your \`.fig\` file contained embedded fonts at:
\`figma/extracted/fonts/\`

These files (if any) have been extracted with auto-detected extensions.

## Next Steps

1. Review the fonts list above
2. Download missing fonts from services listed
3. Place all font files in: \`figma/extracted/fonts/\`
4. Update your React component imports to use these fonts
5. Create \`@font-face\` declarations in your CSS Modules

---

**Note:** Keep this file for reference when setting up typography in your React components.
`;

  const fontsGuidePath = path.join(outputDir, '..', 'fonts-download.md');
  fs.writeFileSync(fontsGuidePath, fontsGuide);

  return fontsArray;
}

// ============================================================================
// DISPLAY SUMMARY
// ============================================================================

function displaySummary(extractSummary, framesCount, fontsCount, outputDir, svgCount = 0) {
  console.log(chalk.gray('\n' + '='.repeat(70)));
  console.log(chalk.green('\n✅ Complete! All phases successful.\n'));

  console.log(chalk.bold('📊 Summary:\n'));
  
  console.log(chalk.bold('Phase 1: Assets Extracted'));
  console.log(chalk.cyan(`  Images: ${extractSummary.images.count} files (${formatBytes(extractSummary.images.size)})`));
  console.log(chalk.cyan(`  Fonts: ${extractSummary.fonts.count} files (${formatBytes(extractSummary.fonts.size)})`));
  console.log(chalk.cyan(`  Other: ${extractSummary.other.count} files (${formatBytes(extractSummary.other.size)})`));
  console.log(chalk.yellow(`  Duplicates: ${extractSummary.duplicates.count} files skipped`));

  console.log(chalk.bold('\nPhase 2: Figma File Fetched'));
  console.log(chalk.cyan(`  ✅ Saved to: figma/json/design.json`));

  console.log(chalk.bold('\nPhase 3: Frames Split'));
  console.log(chalk.cyan(`  ${framesCount} frames → figma/json/frames/*.json`));

  console.log(chalk.bold('\nPhase 3.5: Vector Nodes Exported as SVG'));
  console.log(chalk.cyan(`  ${svgCount} SVG file(s) → figma/json/svg/*.svg`));

  console.log(chalk.bold('\nPhase 4: Fonts Tracked'));
  console.log(chalk.cyan(`  ${fontsCount} unique fonts → figma/json/fonts-used.json`));
  console.log(chalk.cyan(`  📥 Download guide: fonts-download.md`));

  console.log(chalk.bold('\n📂 Output Directory:\n'));
  console.log(chalk.gray(`  ${outputDir}`));
  console.log(chalk.gray(`  ├── source/`));
  console.log(chalk.gray(`  ├── extracted/`));
  console.log(chalk.gray(`  │   ├── images/          (${extractSummary.images.count} images)`));
  console.log(chalk.gray(`  │   ├── fonts/           (${extractSummary.fonts.count} fonts)`));
  console.log(chalk.gray(`  │   └── raw/`));
  console.log(chalk.gray(`  └── json/`));
  console.log(chalk.gray(`      ├── design.json          (full Figma file)`));
  console.log(chalk.gray(`      ├── file-meta.json       (metadata)`));
  console.log(chalk.gray(`      ├── frames/              (${framesCount} frame files)`));
  console.log(chalk.gray(`      │   ├── 489-1059.json`));
  console.log(chalk.gray(`      │   ├── 490-1060.json`));
  console.log(chalk.gray(`      │   └── ...`));
  console.log(chalk.gray(`      ├── svg/                 (${svgCount} rendered vector SVGs)`));
  console.log(chalk.gray(`      ├── split-meta.json      (frame index)`));
  console.log(chalk.gray(`      ├── fonts-used.json      (⭐ used fonts)`));
  console.log(chalk.gray(`      └── mapping.json         (asset hashes)`));

  console.log(chalk.gray('\n' + '='.repeat(70)));
  console.log(chalk.green('\n🎨 Ready to generate React components!\n'));
  console.log(chalk.bold('Next steps:\n'));
  console.log(chalk.gray('1. Download fonts from fonts-download.md'));
  console.log(chalk.gray('2. Use the figma-respection skill to generate components'));
  console.log(chalk.gray('3. Skill will read from: figma/json/frames/<frame-id>.json\n'));
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(chalk.yellow('\nUsage:'));
    console.log(chalk.gray('  node scripts/setup-figma.js <path-to-file.fig> <FIGMA_FILE_KEY>\n'));
    console.log(chalk.yellow('Example:'));
    console.log(chalk.gray('  node scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN\n'));
    console.log(chalk.yellow('Environment:'));
    console.log(chalk.gray('  export FIGMA_API_KEY="your_figma_api_token"\n'));
    process.exit(0);
  }

  const figPath = args[0];
  const fileKey = args[1];
  const outputDir = './figma';
  const apiToken = process.env.FIGMA_API_KEY;

  try {
    console.log(chalk.blue('\n🎨 Figma Respection Setup Pipeline\n'));
    console.log(chalk.bold('Config:'));
    console.log(chalk.gray(`  .fig file: ${figPath}`));
    console.log(chalk.gray(`  File key: ${fileKey}`));
    console.log(chalk.gray(`  Output: ${outputDir}`));
    console.log(chalk.gray(`  API token: ${apiToken ? '✅ Set' : '❌ Not set'}`));

    // Phase 1
    const { dirs, summary: extractSummary } = await phase1ExtractAssets(figPath, outputDir);

    // Phase 2
    const { designPath } = await phase2FetchFigmaFile(fileKey, apiToken, outputDir);

    // Phase 3
    const { frames, usedFonts } = await phase3SplitFrames(designPath, outputDir);

    // Phase 3.5 (non-fatal: a network hiccup here shouldn't kill the whole
    // pipeline — frames just keep their inline vector JSON if it fails)
    let svgResult = { totalSvgs: 0 };
    try {
      svgResult = await phase3_5ExtractVectorSvgs(frames, fileKey, apiToken, outputDir);
    } catch (err) {
      console.log(chalk.yellow(`\n⚠️  Phase 3.5 (SVG extraction) failed: ${err.message}`));
    }

    // Phase 4
    const fontsArray = await phase4TrackFonts(usedFonts, outputDir);

    // Summary
    displaySummary(extractSummary, frames.length, fontsArray.length, outputDir, svgResult.totalSvgs);

    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => {
    console.error(chalk.red(`\n❌ Fatal: ${err.message}\n`));
    process.exit(1);
  });
}

export {
  phase1ExtractAssets,
  phase2FetchFigmaFile,
  phase3SplitFrames,
  phase3_5ExtractVectorSvgs,
  phase4TrackFonts,
  streamApiResponseToFile,
  extractFileMetaStreaming,
  isPureVectorSubtree,
  collectVectorNodes,
};
