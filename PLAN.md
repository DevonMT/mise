# Mise — Project Plan

> **Snap it, paste it, or type it → one smart grocery list you shop from.**
> *Mise en place — everything in its place.*

A personal, install-to-home-screen PWA for Android. Grocery-list-first, with a
self-growing recipe library as a byproduct. All the hard work happens at capture
time (an AI structures messy input); the list itself stays clean and offline.

## Core loop

Capture something messy → AI reads it into structured items → items flow into one
smart list that merges, groups, hides staples, and scales.

## Locked v1 scope

- **Capture** three ways: photo (whiteboard / handwritten / cookbook), recipe URL, typed/pasted text.
- **One active list** + a **"Next time" backlog**.
- **Smarts:** merge duplicates · group by store section · hide staples · scale servings.
- **Recipes** save themselves for one-tap re-adding later.
- **Staples** = a simple ignore-list (no inventory upkeep).
- **Stretch:** rough cost/budget estimate.
- **Out of v1:** voice capture, "what can I make?", sharing.

## Architecture

Two jobs, two homes:

- **Live data → on the phone** (IndexedDB via Dexie). Instant, fully offline, perfect in-store.
- **AI parsing → a small Hono `/api/parse` endpoint on the mini PC** (holds the Claude
  API key). List-building happens at home on wifi, so the mini is reachable on the LAN
  and needs **no internet exposure**. No Railway.
- **Mini PC = the vault:** sync-when-home backup + long-term recipe archive into the Data Platform.

```
PHONE (installed PWA)                MINI PC (home LAN)
- React app, all live data     parse - Hono /api/parse (Claude key)
- IndexedDB (Dexie)          <-----> - calls Claude Sonnet (vision)
- 100% offline in the store          - backup vault -> Data Platform
```

## Stack

| Piece | Choice |
|---|---|
| App | Vite + React + TypeScript, `vite-plugin-pwa` |
| Local data | Dexie (IndexedDB) |
| Parse API | Hono on the mini (Node) |
| AI | Claude Sonnet (`claude-sonnet-5`), vision + JSON output |
| Style | Light, high-contrast, friendly, big touch targets (herb-green accent) |

## The parse contract (Phase 2+)

`POST /api/parse` with a photo / URL / text blob returns:

```jsonc
{
  "sourceType": "recipe" | "list",
  "recipeTitle": "Weeknight Chili",   // when a recipe
  "servings": 4,
  "items": [
    { "displayName": "yellow onion", "canonicalKey": "onion",
      "quantity": 2, "unit": "whole", "section": "produce" }
  ]
}
```

- **Merge** = group by `canonicalKey`, sum compatible units (deterministic client code).
- **Sections** = fixed enum → fixed store-walk order.
- **Scaling** = recipe stores base `servings` + quantities; a slider multiplies.
- **Staples** = ignore-list filters by `canonicalKey` before items land.

## Build phases

- **Phase 1 — Skeleton (DONE ✅)** — installable PWA; manual add/edit/check; section
  grouping; duplicate merge; active list + backlog; Dexie persistence; offline.
- **Phase 2 — The magic (DONE ✅)** — Hono `/api/parse` endpoint (`claude-sonnet-5`,
  structured outputs) + text/paste + recipe-URL capture → structured items → review
  step → merge (with count-unit normalization). Staples ignore-list + Settings screen.
  *Live parse needs an `ANTHROPIC_API_KEY` in `server/.env` — see `server/README.md`.*
- **Phase 3 — Photo + recipes (DONE ✅)** — whiteboard/handwritten photo capture
  (camera → base64 → `claude-sonnet-5` vision); self-saving recipe library; recipe
  detail with servings/batch scaler + add-to-list (merge + staples filtering).
- **Phase 4 — Vault + polish** — at-home backup to the mini into the Data Platform;
  optional cost estimate.

## Phase 1 — what's built

- `src/db.ts` — Dexie schema (items / recipes / staples) + `canonicalize()` merge key.
- `src/sections.ts` — fixed section taxonomy + store-walk order.
- `src/list.ts` — `addItem()` (with merge), `groupBySection()`, `formatQty()`.
- `src/App.tsx` — list UI, tabs (List / Next time), add-edit bottom sheet, overflow menu.
- `src/index.css` — the light/high-contrast design system.
- `vite.config.ts` + `public/icon.svg` — PWA manifest & icon.

## Phase 2 — what's built

- `server/` — Hono parse service (`src/index.ts`, `src/parseContract.ts`): `GET /api/health`,
  `POST /api/parse`. Reads `ANTHROPIC_API_KEY` from `server/.env`; graceful 503 without it.
- `src/parse.ts` — client for the endpoint (`VITE_PARSE_URL`, default `localhost:8787`) + staples lookup.
- `src/Capture.tsx` — the `+` add-menu (type / paste / link) and the capture→review sheet.
- `src/Settings.tsx` — staples ignore-list management.
- `src/list.ts` — `unitKey()` count-unit normalization so "2 onions" and "1 whole onion" merge.

Run: `npm run dev` in `server/` (port 8787) **and** in the repo root (port 5173).
For the phone, build the app with `VITE_PARSE_URL=http://<mini>:8787`.

## Phase 3 — what's built

- `server/src/index.ts` — `/api/parse` now also accepts `type: "image"` (data-URL or
  base64 + `mediaType`) → Claude vision. Handles handwritten/whiteboard photos.
- `src/Capture.tsx` — `📷 Snap a photo` mode (camera `capture="environment"` → data URL);
  recipes auto-save on commit.
- `src/recipes.ts` — `saveRecipeFromParse` (dedupe by title), `addRecipeToList` (scaled, staple-filtered).
- `src/RecipesView.tsx` — 📖 library + detail with a servings/batch scaler.

Launch config: `mise` in `../.claude/launch.json`.

## Deployment (DONE ✅ for the app)

- **Repo:** https://github.com/DevonMT/mise (public). Committed as personal identity (repo-local).
- **Live PWA:** https://devontroedel.com/mise/ — HTTPS, installable. Auto-deploys via
  `.github/workflows/deploy.yml` on every push to `main` (GitHub Pages, `build_type: workflow`).
- Build honors `BASE_PATH=/mise/` and `VITE_PARSE_URL` (a repo **variable**).

## Remaining — make AI capture live

The offline list + recipe library work now. To turn on parsing (text/link/**photo**):

1. Stand up the parse endpoint on the mini over **HTTPS** (Tailscale `serve`), with
   `ANTHROPIC_API_KEY` in `server/.env`. Needs Node installed on the mini (it's bare today).
2. Point the app at it:
   `gh variable set VITE_PARSE_URL -R DevonMT/mise -b "https://<mini-tailscale-host>"`
   then push (or re-run the workflow) to rebuild. Mixed-content rule: the endpoint MUST be HTTPS.

Phase 4 (mini backup + cost estimate) is optional.
