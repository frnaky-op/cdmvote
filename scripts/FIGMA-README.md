# 🚀 Figma Respection — Setup Guide

## 1. Install dependencies
```bash
npm install
```

## 2. Get a Figma API token
1. https://www.figma.com/developers/api#access-tokens
2. Generate a Personal Access Token
3. Add it to `.env` at the project root:
```
FIGMA_API_KEY=figd_your_token_here
```

## 3. Get your file key
From the Figma URL:
```
https://www.figma.com/file/e4pwV0zr4mEdDs7AtzqFYN/My-Design?node-id=489-1059
                            └──────────┬──────────┘
                                   FILE KEY
```

## 4. Export your `.fig` file
Figma → File menu → "Save local copy" (or duplicate + download as `.fig`)

## 5. Run the pipeline (once)
```bash
node --env-file=.env scripts/setup-figma.js design.fig e4pwV0zr4mEdDs7AtzqFYN
```
or via npm script:
```bash
npm run figma:setup -- design.fig e4pwV0zr4mEdDs7AtzqFYN
```

This is the **only step that calls the Figma API** — exactly once, regardless of
how many frames your file has. Everything after this reads local JSON.

## 6. Download fonts
```bash
cat fonts-download.md
```
Follow the links, drop the files into `figma/extracted/fonts/`.

## 7. Generate components (unlimited, no API calls)
Ask the figma-respection skill:
```
Generate the React component for frame 489-1059
```

It reads `figma/json/frames/489-1059.json` directly — instant, offline, no rate limits.

## When the design changes
Re-run step 5. It overwrites `design.json`, `frames/*.json`, and `fonts-used.json`
with fresh data (single API call again).