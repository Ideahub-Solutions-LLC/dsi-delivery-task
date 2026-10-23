# DSI Daily Delivery — offline copy

Downloaded from https://dsi-daily-delivery-oct-dec-2026.ideahub-9058.chatgpt.site/ on 2026-10-23.

## Run it

1. Install Node.js 22 or newer (no other packages are needed).
2. In this folder, run: `npm start` (runs `node dev.mjs`, which reads `.env`)
3. Open http://localhost:3000 — set `PORT` to use another port, e.g. `PORT=3005 npm start`

`npm start` runs the same app that is deployed to Vercel (`public/` + `api/app.js`), with the login,
sign-up and My profile pages described below.

To run the original downloaded copy instead (no login), use `npm run start:offline` (`node server.cjs`).
Opening its `index.html` directly from disk will show a blank page: it loads JavaScript modules from
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
| `server.cjs` | Zero-dependency local server: serves the files and re-creates `/api/state` |
| `package.json` | `npm start` runs the Vercel app locally (`dev.mjs`); `npm run start:offline` runs `server.cjs` |

## About `/api/state`

On the live site, shared progress (task overrides, daily metrics, milestones, audit log) is stored in a
hosted database that this download cannot include. `server.cjs` re-creates the same API locally and saves
changes to `data/state.json`:

- `GET /api/state` returns `{ overrides, metrics, milestones, audit, user, syncedAt }`
- `POST /api/state` with `{ entityType: "task" | "milestone" | "metrics", entityId, data, version }`
  saves the change, bumps its version, adds an audit event, and returns `{ value, event }`

Changes made in this local copy stay local; they do not sync back to the live site.

## Accounts

The Vercel app (`public/`, `api/app.js`, `lib/accounts.js`) opens on a login page. Everyone signs in with
their own email and password; there is no shared team password.

- **Sign up** asks who you are on the team (from *Team & ownership*), your name, email and password.
  Anyone who can reach the site can create an account.
- **Sign in** takes email + password. Passwords are stored as scrypt hashes.
- **My profile** shows your account details and your role, authority, reporting line, backup, hours cap
  and AI agents from *Team & ownership*, plus your deliverable counts. You can edit your name, role,
  phone and time zone.

Accounts are stored in Upstash Redis: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
(or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` pair that Vercel's Upstash integration creates), plus a
`SESSION_SECRET` of at least 32 characters. Without Redis, the login page says sign-in is unavailable.
Locally, `npm start` stores accounts in `data/users.local.json`.
