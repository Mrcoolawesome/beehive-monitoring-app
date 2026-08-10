# Beehive Weight Monitor

Local web dashboard for beehive weight telemetry gathered by a Wii Balance
Board wired into a Raspberry Pi running NASA's [F´](https://fprime.jpl.nasa.gov/)
framework. F´ downlinks weight sessions as JSON files; this app watches a
directory for those files, averages each session's samples, stores the result
in Postgres, and charts it over time.

Stack: Next.js (App Router) + TypeScript + Tailwind + Prisma + PostgreSQL.
No auth/accounts — this is a single-user local app.

See [`docs/planning.md`](docs/planning.md) for the original project planning
doc and the decisions made while implementing it.

## How data flows

The full pipeline spans two repos — this one, and the sibling
`../beehive-project` (the F´ flight software + ground station):

1. F´'s `WiiBoardManager` component (in `../beehive-project`) archives a
   ~60-sample, 1-minute capture on the Pi and downlinks it to the ground
   station (GDS) as a raw `.fdp` data product file, landing in
   `../beehive-project/DpCat/`.
2. `../beehive-project/tools/watch_dpcat_decode.py` decodes each `.fdp` into
   a sibling `.json` file in that same directory — this repo's watcher never
   sees `.fdp` files directly, only the decoded JSON.
3. `scripts/watcher.ts` (this repo) watches `WATCH_DIR` for those new
   `*.json` files.
4. Each file is parsed (`lib/ingest.ts`), samples at or below
   `MIN_VALID_WEIGHT_KG` (0.1 kg) are dropped as tare/warm-up noise, and the
   remaining samples are averaged.
5. The average, timestamp, and `PI_MAC_ADDRESS` are written to the
   `WeightReading` table.
6. The file is moved to `WATCH_DIR/processed/` on success or
   `WATCH_DIR/failed/` if parsing/validation fails (e.g. every sample was
   noise — this happened for several bench-test captures in the real F´
   sample data, where the board was empty).
7. The dashboard (`/`) reads readings for `PI_MAC_ADDRESS` from Postgres and
   polls `/api/readings` every 30s to stay current.

## Running with Docker (recommended for a server)

`docker compose up -d --build` brings up the **entire pipeline described
above** — not just this repo's half of it. `docker-compose.yml` includes
`../beehive-project/docker-compose.yml` (Compose's `include:`, not a git
submodule — the two repos stay independently versioned), which contributes
two services: `gds` (the F´ ground station, receives the Pi's downlink) and
`decoder` (turns its raw `.fdp` output into the `.json` this repo's watcher
reads). Alongside those, this repo's own `Dockerfile` builds one image
reused by three services — `db` doesn't count, that's stock Postgres:

- `db` — Postgres 18, with its own persistent volume
- `migrate` — one-shot job, applies Prisma migrations before `web`/`watcher`
  start
- `web` — the dashboard
- `watcher` — the ingestion process described above
- `gds` / `decoder` — from `../beehive-project`, see that repo's README for
  what they do in more depth

**Requires `../beehive-project` to exist as a sibling directory** (i.e. this
repo and that one checked out next to each other, same as for local dev) —
`include:` resolves that path relative to this repo's `docker-compose.yml`.

**If you previously set up `beehive-project`'s systemd decoder service**
(`beehive-dpcat-decode.service`), stop and disable it before running the
Docker stack — it does the exact same job as the `decoder` service above
against the same directory, and running both is redundant (see the note in
`../beehive-project/README.md` section 6):

```bash
systemctl --user disable --now beehive-dpcat-decode.service
```

1. Copy `.env.example` to `.env` and fill in:
   - `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — credentials for
     the stack's own Postgres container (a separate database from any
     Postgres already installed on the host — no conflict either way).
   - `WATCH_DIR` — the **host** directory F´ writes JSON files into. In the
     combined stack this should point at `../beehive-project/DpCat` — the
     same directory `gds`/`decoder` write to — so this repo's watcher
     actually sees what F´ produces. Bind-mounted into the watcher
     container; see `docker-compose.yml` for exactly how.
   - `PI_MAC_ADDRESS` — same meaning as in local dev (see below).
   - `WATCH_UID` / `WATCH_GID` — optional, only needed if your host user's
     `id -u`/`id -g` isn't 1000/1000 (the common default). The watcher
     container writes into `WATCH_DIR` as this user so the files it moves
     around stay owned by you, not root.

2. On the host (not in a container — this needs the actual F´ build
   toolchain), build the ARM deployment GDS reads its dictionary from, if
   you haven't already:

   ```bash
   cd ../beehive-project && fprime-util build arm-hf-linux
   ```

3. Build and start everything:

   ```bash
   docker compose up -d --build
   ```

   `migrate` runs once per `up` and is a no-op after the first run (Prisma
   only applies migrations that haven't already been applied). `web` and
   `watcher` both wait for it to finish successfully before starting, so
   there's no race against a database that doesn't have the `WeightReading`
   table yet on a fresh volume.

4. Open `http://<server>:3000` for the dashboard, `http://<server>:5000` for
   the GDS web GUI. Watch logs with `docker compose logs -f watcher` (or
   `web`, `db`, `gds`, `decoder`).

To update after pulling new code: `docker compose up -d --build` again — it
rebuilds the image and recreates whatever changed.

## Running without Docker (local development)

### Prerequisites

- Node 20+
- pnpm (`corepack enable` if you don't have it)
- A local PostgreSQL server

### Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a local Postgres role and database (adjust the password):

   ```bash
   sudo -u postgres psql \
     -c "CREATE ROLE beehive_app WITH LOGIN PASSWORD 'CHANGE_ME';" \
     -c "CREATE DATABASE beehive OWNER beehive_app;"
   ```

3. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — matching the role/password from step 2
   - `WATCH_DIR` — the directory F´ (or a script relaying its downlinks) drops
     session JSON files into. Defaults to `./data/incoming`, created
     automatically on first run.
   - `PI_MAC_ADDRESS` — identifies this hive's Pi. Only one Pi exists today,
     so this is a single hardcoded value rather than a per-file field (the F´
     payload doesn't carry a MAC address). Revisit this once there are
     multiple hives.

4. Apply the database schema:

   ```bash
   pnpm db:migrate
   ```

### Running

Two processes run side by side — the web server and the file watcher:

```bash
pnpm dev      # Next.js dev server, http://localhost:3000
pnpm watch    # ingestion watcher (processes existing + new files in WATCH_DIR)
```

For production on the local server, run `pnpm build && pnpm start` for the
web app, and keep `pnpm watch` running persistently (systemd unit or `pm2`),
since it's a long-lived process rather than something Next.js's request/response
model can host. Example systemd unit:

```ini
[Unit]
Description=Beehive telemetry watcher
After=postgresql.service

[Service]
WorkingDirectory=/path/to/beehive-monitoring-app
ExecStart=/usr/bin/pnpm watch
Restart=on-failure
User=devins

[Install]
WantedBy=multi-user.target
```

## Mobile & installing as an app

The dashboard is responsive (usable one-handed on a phone) and is a PWA — on
a phone or desktop, the browser can install it as a standalone app icon
(manifest: `app/manifest.ts`, icons: `public/icons/`, service worker:
`public/sw.js`, registered by `app/components/ServiceWorkerRegistration.tsx`).

**The service worker only caches the static app shell (icons, manifest) —
never the dashboard page or `/api/readings`.** This app's entire purpose is
showing the *current* hive weight, so serving a cached/stale reading would
defeat the point. Offline, the installed app shell still opens; it just
won't have live data until back online.

**Important if you access this from a phone over your LAN** (rather than on
the same machine as `localhost`): browsers only allow service workers (and
therefore PWA installability) over a secure context. `localhost` gets a free
pass, but `http://<server-lan-ip>:3000` from another device does not — the
dashboard itself will work fine either way, it just won't be installable
without HTTPS. A local reverse proxy (Caddy, Tailscale Serve, etc.) handling
TLS in front of `pnpm start` is the usual fix.

## Other useful commands

- `pnpm db:studio` — browse the database in Prisma Studio
- `pnpm lint` / `pnpm exec tsc --noEmit` — lint / typecheck

## Project layout

- `lib/ingest.ts` — parses and validates F´ JSON, computes the filtered average
- `lib/db.ts` — Prisma client (Prisma 7 requires an explicit driver adapter;
  see `@prisma/adapter-pg` usage there)
- `scripts/watcher.ts` — the standalone ingestion process (`pnpm watch`)
- `app/api/readings/route.ts` — GET endpoint, readings for a `?mac=` (defaults
  to `PI_MAC_ADDRESS`)
- `app/components/Dashboard.tsx` / `WeightChart.tsx` — the dashboard UI
  (responsive; see the `sm:` breakpoints throughout for the mobile-vs-desktop
  differences)
- `app/manifest.ts` / `public/sw.js` / `app/components/ServiceWorkerRegistration.tsx`
  — the PWA install manifest, service worker, and its client-side registration
- `prisma/schema.prisma` — the `WeightReading` model

## Future

The F´ project itself lives in `../beehive-project`; the plan is to bring it
in as a git submodule of this repo once the monitoring app has stabilized.
