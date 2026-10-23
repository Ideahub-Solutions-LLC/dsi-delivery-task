# DSI Daily Delivery — offline copy

Downloaded from https://dsi-daily-delivery-oct-dec-2026.ideahub-9058.chatgpt.site/ on 2026-10-23.

## Run it

1. Install Node.js 18 or newer (no other packages are needed).
2. In this folder, run: `node server.cjs`
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
| `server.cjs` | Zero-dependency local server: serves the files and re-creates `/api/state` |
| `package.json` | Lets you run `npm start` instead of `node server.cjs` |

## About `/api/state`

On the live site, shared progress (task overrides, daily metrics, milestones, audit log) is stored in a
hosted database that this download cannot include. `server.cjs` re-creates the same API locally and saves
changes to `data/state.json`:

- `GET /api/state` returns `{ overrides, metrics, milestones, audit, user, syncedAt }`
- `POST /api/state` with `{ entityType: "task" | "milestone" | "metrics", entityId, data, version }`
  saves the change, bumps its version, adds an audit event, and returns `{ value, event }`

Changes made in this local copy stay local; they do not sync back to the live site.

## Accounts and Sign in with Google

The Vercel app (`public/`, `api/app.js`, `lib/accounts.js`) has a login page, a sign-up page and a
**My profile** page linked to each person's role in *Team & ownership*.

- **Sign up** asks for the team access code (the `APP_PASSWORD` value), then who you are on the team,
  your name, email and password — or *Sign up with Google* instead of a password.
- **Sign in** takes email + password or *Sign in with Google*. A Google account whose verified email
  matches an existing account is linked to it automatically.
- Accounts are stored in Upstash Redis, so set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
  (or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` pair that Vercel's Upstash integration creates).
  Without Redis the app falls back to the shared team password and sign-up is disabled.
  Locally, `node dev.mjs` (which reads `.env`) stores accounts in `data/users.local.json`.

To turn on Google sign-in ([Google Identity Services](https://developers.google.com/identity/gsi/web/guides/overview)):

1. In Google Cloud Console → *APIs & Services* → *Credentials*, create an **OAuth client ID** of type *Web application*.
2. Under **Authorized JavaScript origins** add your site, e.g. `https://<your-project>.vercel.app` (plus any custom domain),
   plus `http://localhost` and `http://localhost:3000` for local testing. No redirect URI is needed.
3. Set `GOOGLE_CLIENT_ID` to the client ID in Vercel (and in `.env` locally), then redeploy.

The server verifies every Google ID token's signature, issuer, audience, expiry and email verification
before signing anyone in.
