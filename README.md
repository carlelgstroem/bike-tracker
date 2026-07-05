# Munin — *Ska jag cykla idag?*

A self-hosted cycling-readiness dashboard. It combines your **WHOOP** recovery data
with the local **weather** forecast and gives a morning verdict: hard intervals on the
road bike, an easy gravel spin, or a rest day.

> Munin is the sibling of Hugin (the boat monitor) — Odin's two ravens.

- **Backend:** Node.js + TypeScript, Fastify, SQLite (better-sqlite3).
- **Frontend:** one server-rendered, mobile-first page (dark-mode friendly). No framework.
- **Data:** WHOOP API v2 (OAuth 2.0, polled) + Open-Meteo (no key).
- **Verdict:** a pure, unit-tested function with tunable thresholds.

---

## Run locally (macOS / Linux)

Prereqs: Node ≥ 20.

```bash
cp .env.example .env         # then fill in WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET
npm install
npm run dev                  # http://localhost:3000
```

**Connect WHOOP (one time):** in the [WHOOP Developer Dashboard](https://developer.whoop.com)
register your app and add this redirect URI:

```
http://localhost:3000/auth/whoop/callback
```

Then open <http://localhost:3000/auth/whoop>, approve, and you're done — tokens are
saved to SQLite and refreshed automatically. On first run Munin backfills ~30 days of
history so the day-toggle and sparkline have data immediately.

Scopes used: `read:recovery read:sleep read:cycles read:workout read:profile read:body_measurement offline`.

### Handy URLs

| URL | What |
|---|---|
| `/` | Dashboard. `?day=YYYY-MM-DD` views a past day. |
| `/auth/whoop` | Start the WHOOP OAuth flow. |
| `/api/dashboard` | The dashboard view model as JSON. |
| `/api/backfill?days=90` | Re-import history (idempotent). |
| `/health` | Liveness (not behind auth). |

### Tests / typecheck

```bash
npm test          # verdict + weather unit tests
npm run typecheck
```

---

## Deploy to Railway

Munin ships a `Dockerfile` and `railway.json`; Railway builds and runs the container.
Because this puts personal health data on a public URL, **auth is mandatory** — the app
*refuses to start* on a public host unless `AUTH_PASSWORD` is set.

### 1. Push this repo to GitHub, then create a Railway service

- New Project → **Deploy from GitHub repo** → pick this repo.
  (Railway auto-detects the `Dockerfile`.)
- Or, with the CLI: `railway init` then `railway up`.

### 2. Add a Volume (so your SQLite history survives redeploys)

Service → **Volumes** → New Volume, mount path:

```
/app/data
```

### 3. Set service Variables

| Variable | Value |
|---|---|
| `HOST` | `0.0.0.0` |
| `AUTH_PASSWORD` | a strong password (you'll enter it in the browser) |
| `AUTH_USER` | `munin` (or your choice) |
| `WHOOP_CLIENT_ID` | from WHOOP |
| `WHOOP_CLIENT_SECRET` | from WHOOP |
| `BASE_URL` | your public URL, e.g. `https://munin-production.up.railway.app` |
| `LATITUDE` / `LONGITUDE` / `TIMEZONE` | optional (defaults to Washington, DC) |

`PORT` is injected by Railway automatically — don't set it. `DATABASE_PATH`
defaults to `/app/data/munin.db` in the container.

> Chicken-and-egg: you only learn your `BASE_URL` after the first deploy generates a
> domain (Service → Settings → Networking → Generate Domain). Set `BASE_URL` to it, then
> redeploy.

### 4. Register the redirect URI in WHOOP

Add to your WHOOP app's redirect URIs:

```
https://<your-app>.up.railway.app/auth/whoop/callback
```

### 5. Connect and go

Visit `https://<your-app>.up.railway.app/` — the browser prompts for the Basic-auth
username/password (`AUTH_USER` / `AUTH_PASSWORD`). Then open `/auth/whoop` once to link
WHOOP. Backfill runs automatically and the dashboard is live.

### Cost note

Railway can sleep idle services. Munin refreshes data on every page load when older than
30 min (and on startup), so an on-demand wake is enough for a morning glance — but the
background poller only runs while the service is up. Keep at least one instance running if
you want scheduled polling.

---

## How the verdict works

Inputs: recovery %, HRV vs 30-day baseline, resting HR vs baseline, sleep performance,
yesterday's strain, and today's weather window. Thresholds live in
`src/config/thresholds.ts` so you can tune them.

- **Recovery ≥ 67 and sleep ≥ 80%** → *Ja — kör hårt* (road-bike intervals, strain 14–16, ~90% HR).
- **Recovery 34–66, or green on poor sleep** → *Ja — lugnt* (gravel zone 2, strain < 10, ~70% HR).
- **Recovery < 34, or HRV > 15% below baseline** → *Nej — vila* (rest).
- If the best weather window is under 1 h, the outdoor ride is downgraded to indoor.

Weather "best window" = the longest contiguous block 06:00–20:00 with rain probability
< 30% and wind < 30 km/h.
