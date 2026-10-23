# DSI Daily Delivery — offline copy

Downloaded from https://dsi-daily-delivery-oct-dec-2026.ideahub-9058.chatgpt.site/ on 2026-10-23.

## Run it

1. Install Node.js 18 or newer (no other packages are needed).
2. In this folder, run: `node server.js`
3. Open http://localhost:3000

Opening `index.html` directly from disk will show a blank page: the app loads JavaScript modules from
absolute `/_next/...` paths, which browsers only allow over http(s). Use the server, or any static host
that serves this folder at the site root and also provides the `/api/state` endpoint below.

## What's inside

| Path | Purpose |
| --- | --- |
| `index.html` | The page as served by the live site, including the embedded delivery plan data |
| `_next/static/chunks/*.js` | App JavaScript (framework, router runtime, delivery console UI, icons) |
| `_next/static/css/*.css` | All styles |
| `favicon.svg` | Site icon |
| `data/state.json` | Snapshot of the shared tracker progress (`/api/state`) at download time |
| `server.js` | Zero-dependency local server: serves the files and re-creates `/api/state` |
| `package.json` | Lets you run `npm start` instead of `node server.js` |

## About `/api/state`

On the live site, shared progress (task overrides, daily metrics, milestones, audit log) is stored in a
hosted database that this download cannot include. `server.js` re-creates the same API locally and saves
changes to `data/state.json`:

- `GET /api/state` returns `{ overrides, metrics, milestones, audit, user, syncedAt }`
- `POST /api/state` with `{ entityType: "task" | "milestone" | "metrics", entityId, data, version }`
  saves the change, bumps its version, adds an audit event, and returns `{ value, event }`

Changes made in this local copy stay local; they do not sync back to the live site.
