# Mise — parse server

A tiny Hono service that turns messy grocery/recipe input into structured items
via Claude (`claude-sonnet-5`, structured outputs). This is the only piece that
needs the internet + the Claude API key; the app's data lives on the phone.

## Setup

```bash
cd server
npm install
cp .env.example .env      # then edit .env and paste your key
npm run dev               # http://localhost:8787  (watch mode)
```

`.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
PORT=8787
```

> The key stays server-side — never in the PWA. `.env` is gitignored.

## Endpoints

- `GET /api/health` → `{ ok, hasKey, model }`
- `POST /api/parse` → body `{ "type": "text" | "url", "content": "..." }`,
  returns the parse contract:

  ```jsonc
  {
    "sourceType": "recipe" | "list",
    "recipeTitle": "…" | null,
    "servings": 4 | null,
    "items": [
      { "displayName": "yellow onion", "canonicalKey": "onion",
        "quantity": 2, "unit": "whole", "section": "produce" }
    ]
  }
  ```

Without a key, `/api/parse` returns `503` with a clear message (health still works).

## Where it runs

Designed to run on the **mini PC** on the home LAN. List-building happens at home
on wifi, so the phone reaches the mini directly — no internet exposure needed.
Point the app at it by building the frontend with `VITE_PARSE_URL=http://<mini>:8787`.

## Quick check

```bash
curl -s localhost:8787/api/health
curl -s localhost:8787/api/parse -H 'content-type: application/json' \
  -d '{"type":"text","content":"2 onions, a gallon of milk, chicken breast"}'
```
