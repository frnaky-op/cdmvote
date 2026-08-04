---
name: figma-respection
description: "Automate the conversion of specific Figma frames into production-ready React pages (Component.jsx and Component.module.css) matching a strict project architecture. Use this skill whenever a user requests Figma-to-React conversion, asks to generate components from Figma frames, needs to extract design specifications into JSX/CSS, or wants to maintain strict parity between Figma prototypes and React code. Triggers include: 'Generate [FrameName]', 'Convert Figma frame to React', 'Create component from Figma', or any request to build React components that reference specific Figma design files."
---

# Figma-Respection: Figma Frames to Production React Components

Automated conversion of Figma design frames into production-ready React pages (`Component.jsx` and `Component.module.css`) that maintain strict architectural compliance and design fidelity.

Uses **local cached frame data** (no API calls) after initial setup pipeline.

> **Shared figma folder:** The `../figma/` directory lives one level above the project root at `../../figma/` (i.e. `cbi-games/../figma/`). All paths in this skill use `../../figma/` accordingly.

---

## ⚡ Quick Start (Two Commands)

### Setup Phase (Run Once)
```bash
# Set your Figma API token
export FIGMA_API_KEY="your_figma_api_token_here"

# Run unified pipeline: extract → fetch → split → track fonts
node scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN
```

**What this does:**
- ✅ Extracts assets from `.fig` file (images, fonts)
- ✅ Fetches complete Figma file from API (1 call)
- ✅ Splits into individual frame JSON files
- ✅ Tracks used fonts for download
- ✅ Creates fonts-download.md guide

**Output:**
```
../figma/json/
├── frames/489-1059.json          ⭐ Ready for component generation
├── frames/490-1060.json
├── fonts-used.json               ⭐ All fonts in design
├── design.json                   (full file backup)
└── mapping.json                  (asset hashes)
```

### Generation Phase (Run Unlimited)
```bash
# Use skill to generate components (no API calls after setup)
Prompt: "Generate React component for frame 489-1059"
```

**Speed:** Instant (reads from local cache, no network)

---

## 📋 Detailed Workflow

### Phase 1: Local Setup
**Command:** `node scripts/setup-figma.js <design.fig> <FILE_KEY>`

**Example:**
```bash
node scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN
```

**Output:**
```
🎨 Figma Respection Setup Pipeline

📦 PHASE 1: Extract .fig Assets
  ✅ Images: 142 files (43.2 MB)
  ✅ Fonts: 8 files (1.8 MB)

🌐 PHASE 2: Fetch Figma File from API
  ✅ Fetched: My Design System

📑 PHASE 3: Split Frames into Individual Files
  ✅ Split 47 frames into individual files

🔤 PHASE 4: Extract & Track Used Fonts
  ✅ Found 12 unique fonts → ../figma/json/fonts-used.json
  ✅ Download guide: fonts-download.md
```

**Files Created:**
- `../figma/extracted/images/` — Extracted images
- `../figma/extracted/fonts/` — Extracted fonts from .fig
- `../figma/json/frames/489-1059.json` — Individual frame files (ready for generation)
- `../figma/json/fonts-used.json` — List of all fonts used
- `fonts-download.md` — Guide to download fonts

### Phase 2: Component Generation
**Use the figma-respection skill** (reads from cache, no API)

**Prompt Template:**
```
Generate the React component for frame 489-1059

Expected output:
- Component.jsx (with className references to CSS Module)
- Component.module.css (all styling with absolute positioning)
```

**What the skill does:**
1. Reads: `../figma/json/frames/489-1059.json` (local file, instant)
2. Resolves: All images via `../figma/mapping.json` (local file)
3. Extracts: Typography, colors, positioning from JSON
4. Generates: JSX + CSS Module with exact fidelity
5. Validates: All imports, asset resolution, style coverage

---

## 🔄 Unified Pipeline Details

### setup-figma.js Flow

```
┌─────────────────────────────────────────────────────┐
│ INPUT                                               │
│ - design.fig (your .fig file)                       │
│ - e4pwV0zr4mEdDs7AtzqFYN (Figma file key)          │
│ - $FIGMA_API_KEY (environment variable)            │
└──────────────┬──────────────────────────────────────┘
               ↓
       ┌───────────────────┐
       │ PHASE 1: EXTRACT  │
       │  .fig ZIP → ...   │
       └───────────┬───────┘
                   ↓
           ../figma/extracted/
           ├── images/
           └── fonts/
               ↓
       ┌───────────────────────┐
       │ PHASE 2: FETCH API    │
       │ 1 Figma API call      │
       └───────────┬───────────┘
                   ↓
           ../figma/json/design.json
               ↓
       ┌───────────────────────┐
       │ PHASE 3: SPLIT        │
       │ Parse design.json     │
       │ Create frame files    │
       └───────────┬───────────┘
                   ↓
           ../figma/json/frames/
           ├── 489-1059.json
           ├── 490-1060.json
           └── ...
               ↓
       ┌───────────────────────┐
       │ PHASE 4: TRACK FONTS  │
       │ Extract used fonts    │
       │ Create download guide │
       └───────────┬───────────┘
                   ↓
           ../figma/json/fonts-used.json
           fonts-download.md
```

---

## 📂 Output Directory Structure

After running setup pipeline:

```
project-root/
├── scripts/
│   └── setup-figma.js              (the unified pipeline)
│
├── ../figma/
│   ├── source/
│   │   └── design.fig              (your .fig file archived)
│   │
│   ├── extracted/
│   │   ├── images/                 (PNG, JPG, WebP, SVG, etc.)
│   │   │   ├── a3f5c2b1d4e9.png
│   │   │   ├── b7e2f9c4a1d5.jpg
│   │   │   └── ...
│   │   ├── fonts/                  (TTF, OTF, WOFF, WOFF2)
│   │   │   ├── d2c8f1e3a5b7.ttf
│   │   │   └── ...
│   │   ├── preview/
│   │   └── raw/
│   │
│   └── json/
│       ├── design.json             (full Figma file)
│       ├── file-meta.json          (file name, version, last modified)
│       ├── frames/                 ⭐ MAIN: Individual frame files
│       │   ├── 489-1059.json       (frame data ready for component gen)
│       │   ├── 490-1060.json
│       │   └── ... (one per frame)
│       ├── split-meta.json         (index of all frames)
│       ├── fonts-used.json         ⭐ Font tracking
│       └── mapping.json            (asset hash → file mappings)
│
└── fonts-download.md               ⭐ How to download used fonts
```

---

## 🎯 Skill Workflow (After Setup)

### Trigger
User requests: "Generate React component for frame 489-1059"

### Step 1: Load Frame Data (Cache)
```markdown
- ✅ Read ../figma/json/frames/489-1059.json
- Extract frame: { id, name, bounds, children, fills, strokes, ... }
- No API calls (data already local)
```

### Step 2: Resolve Assets
```markdown
- Read ../figma/json/mapping.json
- For each image in frame:
  - Find asset hash in frame JSON
  - Resolve to local file: ../figma/extracted/images/<hash>.<ext>
  - Generate import: import Logo from '@/assets/figma-exports'
- Flag unmatched assets with // TODO
```

**Never call the Figma MCP `download_assets` tool during this step.** Assets
were already extracted locally during setup. Before flagging anything as
missing:
1. Look in `../figma/extracted/images/` for the asset (by hash from
   `mapping.json`, or by name/visual match).
2. Also check `../figma/extracted/preview/` and `../figma/extracted/raw/` —
   screenshots and unmapped exports can live there too.
3. Only if the asset genuinely isn't present in any of those folders,
   leave a `// TODO` comment noting the missing asset name — do not
   trigger a new download.

### Step 3: Extract Design Tokens
```markdown
- Typography: Font family, size, weight, line height, letter spacing
- Colors: Fill colors, stroke colors (exact hex/rgb/hsl)
- Positioning: Absolute coordinates (top, left, width, height)
- Layout: Z-index, opacity, blend modes, effects
- States: Hover, active, disabled (if defined)
```

### Step 4: Generate Components
```markdown
- JSX Component (Component.jsx):
  - Semantic HTML structure
  - className references to CSS Module
  - Props for dynamic content
  - Integration with useTranslation, useSound, etc.
  
- CSS Module (Component.module.css):
  - Exact positioning from Figma
  - Typography properties
  - Color values
  - Responsive breakpoints (if defined)
```

### Step 5: Validate
```markdown
- ✅ All positioning matches Figma coordinates
- ✅ Typography fidelity (font, size, weight, line-height)
- ✅ Colors match exactly (hex/rgb/hsl)
- ✅ Images resolve via useAssets() hook
- ✅ No unresolved imports or assets
- ✅ CSS coverage for all elements
```

---

## 🔤 Fonts Workflow

### During Setup
Script extracts all fonts used in design:

**../figma/json/fonts-used.json:**
```json
{
  "count": 12,
  "fonts": [
    { "family": "Inter", "weight": 400, "style": "Inter" },
    { "family": "Inter", "weight": 500, "style": "Inter Medium" },
    { "family": "Inter", "weight": 700, "style": "Inter Bold" },
    { "family": "Playfair Display", "weight": 700, "style": "Playfair Display" },
    ...
  ]
}
```

### fonts-download.md Guide
Provides:
- ✅ List of all fonts used
- ✅ Links to Google Fonts, Adobe Fonts, etc.
- ✅ Where to place downloaded fonts
- ✅ How to import in CSS
- ✅ Font file location reminder

**Example:**
```markdown
# 🔤 Fonts Used in Design

## Used Fonts (12 total)

- **Inter** (Weight: 400)
- **Inter** (Weight: 500)
- **Inter** (Weight: 700)
- **Playfair Display** (Weight: 700)

## Download Links

### Google Fonts
Search for: Inter, Playfair Display
https://fonts.google.com/

### Installation
1. Download fonts
2. Place in: ../figma/extracted/fonts/
3. Use @font-face in CSS
```

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Get Figma API Token
1. Go to https://www.figma.com/api/docs/getting-started#authentication
2. Create a Personal Access Token
3. Copy the token

### Step 2: Export Your Design File
1. Open your Figma file
2. File → Export → Export as .fig
3. Save as `design.fig`

### Step 3: Get File Key
1. Open your Figma file in browser
2. URL: `https://www.figma.com/file/<FILE_KEY>/...`
3. Copy the `<FILE_KEY>` part

### Step 4: Run Setup Pipeline
```bash
# Set API token
export FIGMA_API_KEY="figd_your_token_here_..."

# Run pipeline
node scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN

# Expected output:
# 📦 PHASE 1: Extract .fig Assets
# 🌐 PHASE 2: Fetch Figma File from API
# 📑 PHASE 3: Split Frames into Individual Files
# 🔤 PHASE 4: Extract & Track Used Fonts
# ✅ Complete! All phases successful.
```

### Step 5: Download Fonts
```bash
# Review fonts used
cat fonts-download.md

# Download from Google Fonts, Adobe, etc.
# Place in ../figma/extracted/fonts/
```

### Step 6: Generate Components
Use the figma-respection skill to generate components. Skill will:
- Read from local cache (no API calls)
- Resolve all images automatically
- Generate exact replicas of Figma frames

---

## 📊 Frame ID Formats

Frame IDs can be specified in multiple formats:

### From Figma URL
```
https://www.figma.com/file/ABC123/Design?node-id=489:1059
                                                    ↑
                                            Frame ID with colon
```

### Prompt Formats (All Work)
```
- "Generate frame 489:1059"        ✅ Colon format (as shown in URL)
- "Generate frame 489-1059"        ✅ Dash format (internal use)
- "Generate node 489:1059"         ✅ Colon format
- "Create component for 489-1059"  ✅ Dash format
```

The skill automatically normalizes both formats to `489-1059` for file lookup.

---

## 🛠️ Troubleshooting

### "FIGMA_API_KEY not set"
```bash
# Set the environment variable
export FIGMA_API_KEY="your_token_here"

# Verify it's set
echo $FIGMA_API_KEY
```

### "Figma file not found"
- Check file key is correct
- Verify you can access the file in your Figma account
- Try exporting a fresh .fig file

### "Rate limit exceeded"
This shouldn't happen because setup-figma.js makes **only 1 API call**.
If you're still seeing rate limits:
- Wait a few minutes
- Check FIGMA_API_KEY is correct
- Ensure you're not running multiple setup commands simultaneously

### "Frame not found in cache"
- Verify frame ID format (should be `489-1059` or `489:1059`)
- Check `../figma/json/split-meta.json` for available frames
- Re-run setup pipeline if design file was updated

### "Image/Asset not resolving"
- Check `../figma/json/mapping.json` for asset hashes
- Verify image files exist in `../figma/extracted/images/` (also check
  `../figma/extracted/preview/` and `../figma/extracted/raw/` for screenshots
  or unmapped exports)
- Do **not** call the `download_assets` MCP tool — assets are already
  extracted locally; re-check the folders above instead of re-downloading
- Ensure useAssets() hook is properly imported
- Leave `// TODO` comment and note missing asset name only if the asset
  truly isn't present anywhere in `../figma/extracted/`

---

## 📝 Key Rules & Constraints

### 1. Figma MCP Not Used (Local Cache Only)
- ✅ **No MCP calls** after setup phase
- ✅ All data from local JSON files
- ✅ Zero API calls per component generation
- ✅ Unlimited components without rate limits

### 2. Asset Management
- Use `useAssets()` hook for all images
- Asset hashes are in `../figma/mapping.json`
- Images and screenshots live in `../figma/extracted/images/` (also check
  `../figma/extracted/preview/` and `../figma/extracted/raw/`) — always check
  there first
- Never call the `download_assets` MCP tool for this skill's flow; assets
  are already extracted locally during setup
- Flag unmatched assets with `// TODO` only after confirming they're not
  in any `../figma/extracted/` subfolder

### 3. CSS & Layout
- CSS Modules only (no inline styles)
- Exact absolute positioning from Figma
- No auto-centering or redesigns
- Preserve layout hierarchy and z-index

### 4. Typography & Colors
- Duplicate all font properties exactly
- Extract exact color values (hex/rgb/hsl)
- Create semantic color tokens if reused
- Apply anti-aliasing hints

### 5. Components & Logic
- Break repeated elements into reusable components
- Keep single-use items inline
- Integrate existing hooks without replacement
- Accept props for dynamic content

### 6. Animations
- Only implement if Figma prototypes define transitions
- Use GSAP for complex animations
- Otherwise keep UI static
- Document timing and easing

---

## 📚 Example Prompts

### Basic Component Generation
```
Generate the React component for frame 489-1059 named "Hero Section"

Output:
- Component.jsx (with all nodes as JSX elements)
- Component.module.css (with exact positioning and styles)
```

### With Custom Name
```
Generate the "HeroSection" component from frame 489-1059

Expected:
- HeroSection.jsx
- HeroSection.module.css
```

### With Specific Features
```
Generate component for frame 490-1060 with:
- All images resolved via useAssets() hook
- useTranslation hook for any text
- Hover states from Figma variants
- No animations (keep it static)
```

---

## 🔄 Workflow Comparison

### Before (API Calls Per Component)
```
Setup: Export .fig
Generate Component 1: Call Figma API → Component
Generate Component 2: Call Figma API → Component
Generate Component 3: Call Figma API → Component
...
Total API calls: N (hits rate limit fast) ❌
```

### After (Single Setup, Unlimited Generation)
```
Setup: node scripts/setup-figma.js design.fig KEY (1 API call)
  → Creates ../figma/json/frames/*.json

Generate Component 1: Read cache → Component ✅
Generate Component 2: Read cache → Component ✅
Generate Component 3: Read cache → Component ✅
...
Total API calls: 1 (no rate limiting) ✅
```

---

## ✨ Next Steps

1. ✅ Run setup pipeline once: `node scripts/setup-figma.js design.fig KEY`
2. ✅ Download fonts from `fonts-download.md`
3. ✅ Generate unlimited components with zero API calls
4. ✅ Use cached frame data for instant component creation

---

## 📞 Support

**Setup Issues:**
- Verify FIGMA_API_KEY is set
- Check .fig file exists and is valid
- Ensure file key is correct

**Component Generation Issues:**
- Check frame ID format (489-1059 or 489:1059)
- Verify frame exists in split-meta.json
- Review ../figma/json/frames/<id>.json for structure

**Font Issues:**
- Review fonts-download.md for all fonts used
- Check ../figma/json/fonts-used.json for complete list
- Download and place in ../figma/extracted/fonts/

---

**Ready to get started? Run:**
```bash
export FIGMA_API_KEY="your_token"
node scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN
```

**✨ Then use the skill to generate unlimited React components!**