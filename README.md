# Beehive Weight Monitor

Local web dashboard for beehive weight telemetry gathered by a Wii Balance
Board wired into a Raspberry Pi running NASA's [F´](https://fprime.jpl.nasa.gov/)
framework. F´ downlinks weight sessions as JSON files; this app watches a
directory for those files, averages each session's samples, stores the result
in Postgres, and charts it over time.

Stack: Next.js (App Router) + TypeScript + Tailwind + Prisma + PostgreSQL +
Auth.js. Real accounts: an **admin** registers Pis/boards and assigns each
Pi to a user in `/admin`; everyone else is a read-only **viewer**, seeing
only the Pi(s)/board(s) assigned to them on the main dashboard (`/`).

See [`docs/planning.md`](docs/planning.md) for the original project planning
doc and the decisions made while implementing it.

## Data model

- **User** — email/password (bcrypt-hashed), `role` of `ADMIN` or `VIEWER`.
- **Pi** — one Raspberry Pi, owned by a `User`. Its Tailscale MagicDNS name
  (`tailscaleName`) resolves to `resolvedIp`, and it gets a unique
  `assignedPort` at registration — every Pi gets its own dedicated GDS/
  decoder pipeline on that port rather than sharing one, so a downlinked
  reading is always unambiguously "from this Pi." SSH keypair
  generation/storage and the resolve/deploy automation those fields are for
  are handled by `scripts/deployer.ts` — see "Fleet management: registering
  and deploying to a Pi" below.
- **Board** — one Wii Balance Board wired to a specific `Pi`, identified by
  Bluetooth MAC and a `slotIndex` (0–3, matching which `WiiBoardManager`
  instance the flight software deploys it to — see the beehive-project
  repo). Up to 4 boards per Pi.
- **WeightReading** — one averaged session, belonging to exactly one
  `Board`.

`scripts/create-admin.ts` bootstraps the very first admin account (there's
no self-serve path to `ADMIN` — every other account starts as `VIEWER`,
promoted only by direct DB access today):

```bash
pnpm create-admin you@example.com 'a real password'
```

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
3. `scripts/watcher.ts` (this repo, one process per Pi — see `PI_ID` below)
   watches `WATCH_DIR` for those new `*.json` files.
4. Each file is parsed (`lib/ingest.ts`), samples at or below
   `MIN_VALID_WEIGHT_KG` (0.1 kg) are dropped as tare/warm-up noise, and the
   remaining samples are averaged.
5. The average, timestamp, and the resolved `Board` (see `PI_ID` below —
   today this only works cleanly with exactly one board per Pi; see
   `scripts/watcher.ts`'s `resolveBoard()`) are written to the
   `WeightReading` table.
6. The file is moved to `WATCH_DIR/processed/` on success or
   `WATCH_DIR/failed/` if parsing/validation fails (e.g. every sample was
   noise — this happened for several bench-test captures in the real F´
   sample data, where the board was empty).
7. The dashboard (`/`) reads readings for whichever board(s) are assigned
   to the signed-in user and polls `/api/readings` every 30s to stay
   current.

## Running with Docker (recommended for a server)

`docker compose up -d --build` brings up **this repo's half of the
pipeline** — `db`, `migrate`, `web`, `watcher`. This repo's own
`Dockerfile` builds one image reused by all three app services (`db`
doesn't count, that's stock Postgres):

- `db` — Postgres 18, with its own persistent volume
- `migrate` — one-shot job, applies Prisma migrations before `web`/`watcher`
  start
- `web` — the dashboard
- `watcher` — the ingestion process described above

The F´ ground station (GDS/decoder) is **not** part of this compose file.
It used to be — a single shared `gds`/`decoder` pair, pulled in from
`../beehive-project`'s own `docker-compose.yml` via Compose's `include:` —
but that stopped making sense once fleet management shipped: every
registered Pi now gets its own dedicated `beehive-gds-<piId>`/
`beehive-decoder-<piId>` container pair, created automatically by
`scripts/deployer.ts` (see "Fleet management" below), not by `docker
compose up`. Register a Pi in `/admin/pis` to get one running against it.

**If you previously set up `beehive-project`'s systemd decoder service**
(`beehive-dpcat-decode.service`) for a Pi that's now fleet-managed, stop
and disable it — `scripts/deployer.ts`'s per-Pi decoder container does the
same job against the same Pi's `DpCat/<piId>/` directory, and running both
is redundant (see the note in `../beehive-project/README.md` section 6):

```bash
systemctl --user disable --now beehive-dpcat-decode.service
```

1. Copy `.env.example` to `.env` and fill in:
   - `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — credentials for
     the stack's own Postgres container (a separate database from any
     Postgres already installed on the host — no conflict either way).
   - `WATCH_DIR` — the **host** directory this repo's watcher reads decoded
     JSON from. Once a Pi is registered and active (see "Fleet management"
     below), this is `<BEEHIVE_PROJECT_DIR>/DpCat/<piId>/fprime-downlink` —
     that specific Pi's decoder container's output directory. Chicken-and-egg
     at first setup: you need the Pi registered (to know its id) before you
     can fill this in, so it's normal to come back and set this (and
     `PI_ID` below) after "Fleet management"'s steps, not before. Bind-mounted
     into the watcher container; see `docker-compose.yml` for exactly how.
   - `PI_ID` — which registered Pi (see Data model above) this watcher
     instance ingests readings for. Register the Pi and give it exactly one
     board in `/admin` first — the watcher fails fast at startup otherwise.
   - `AUTH_SECRET` — signs/encrypts session tokens. Generate one with
     `openssl rand -base64 32`.
   - `WATCH_UID` / `WATCH_GID` — optional, only needed if your host user's
     `id -u`/`id -g` isn't 1000/1000 (the common default). The watcher
     container writes into `WATCH_DIR` as this user so the files it moves
     around stay owned by you, not root.

2. Build and start:

   ```bash
   docker compose up -d --build
   ```

   `migrate` runs once per `up` and is a no-op after the first run (Prisma
   only applies migrations that haven't already been applied). `web` and
   `watcher` both wait for it to finish successfully before starting, so
   there's no race against a database that doesn't have the `WeightReading`
   table yet on a fresh volume. `watcher` will crash-loop harmlessly until
   `PI_ID`/`WATCH_DIR` point at a real, registered, single-board Pi.

3. Open `http://<server>:${WEB_PORT:-3000}` for the dashboard. Watch logs
   with `docker compose logs -f watcher` (or `web`, `db`).

4. Follow "Fleet management" below to register a Pi through `/admin/pis` —
   that's what actually gets a GDS/decoder pair (and eventually the flight
   binary on the Pi itself) running.

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
   - `AUTH_SECRET` — generate with `openssl rand -base64 32`.
   - `PI_ID` — only needed to run `pnpm watch`; see Data model above for how
     to register a Pi first.

4. Apply the database schema:

   ```bash
   pnpm db:migrate
   ```

5. Create the first admin account (see Data model above):

   ```bash
   pnpm create-admin you@example.com 'a real password'
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

## Fleet management: registering and deploying to a Pi

Adding a Pi to the fleet and getting the flight binary running on it is
driven from `/admin/pis`, but the actual ssh/tailscale/docker work happens
in **`scripts/deployer.ts`**, a separate long-running process — the admin
panel itself runs inside the `web` Docker container, which deliberately
has none of those tools or a route onto the tailnet. The admin panel and
the deployer talk to each other only through the database: an admin action
sets `Pi.pendingAction`, and the deployer polls for that and clears it once
handled (see `PiPendingAction` in `prisma/schema.prisma`).

1. **Set the GDS server address once**, in `/admin/server` — this is what
   gets baked into every Pi's systemd `ExecStart` as `-a <host>` (see
   `../beehive-project/README.md` section 8).
2. **Register a Pi** in `/admin/pis`: a name, its Tailscale MagicDNS name
   (e.g. `beehive0` — not a raw IP, see the `Pi.tailscaleName` comment in
   `prisma/schema.prisma`), and which user it belongs to. This assigns the
   next free port and creates the row as `PENDING_SETUP`.
3. **Wait a few seconds, then open the Pi's detail page.** The deployer
   generates an SSH keypair for every Pi that doesn't have one yet
   (`ensureKeypairs()` in `scripts/deployer.ts`) on its own poll cycle —
   once that's happened, the page shows the public key and a
   copy-pasteable one-liner to install it on the Pi (the one manual,
   physical step — same action as a normal `ssh-copy-id`, just against a
   key the app generated instead of your own).
4. **Add board(s)** for the Pi (Bluetooth MAC, label, slot 0–3) if you
   haven't already. Don't already know a new board's MAC (it isn't printed
   anywhere convenient)? Click **"Scan for new board"** and press the sync
   button inside the board's battery compartment while it runs (~20s) —
   this queues `SCAN_FOR_BOARDS`; the deployer briefly stops
   `beedeployment.service` (its own WiiBoardManager instances retry
   connecting roughly once a second whenever a configured board isn't
   connected, each attempt cycling `bluetoothctl` scan on/off - left
   running, that stomps on this scan's own discovery window - confirmed
   live), runs a bounded `bluetoothctl` scan on the Pi over SSH (no
   flight-software or GDS protocol involved), then restarts the service.
   Any newly-discovered board's MAC shows up with a "Use this MAC" button
   that fills it into the form below, so you
   still choose the label/slot yourself rather than it being added
   automatically.
5. Once the public key is installed on the Pi, click **"Run initial
   setup."** This queues `INITIAL_SETUP`; the deployer resolves the Pi's
   IP if needed, uploads the `aarch64-linux` binary + `boot_dp_downlink.bin`
   + a generated `boards.txt` (from step 4's boards), then runs
   `../beehive-project/tools/install_beedeployment_service.sh` on the Pi
   over SSH to install and start its systemd service. On success the Pi
   becomes `ACTIVE`.
6. From here on, **the deployer keeps it up to date on its own**: every
   `SLOW_POLL_MS` (5 min) it checks whether `beehive-project`'s
   `origin/main` has moved, rebuilds (`fprime-util build aarch64-linux`) if
   so, and re-deploys the new binary to every `ACTIVE` Pi whose
   `lastDeployedSha` is behind. Changed a Pi's boards without a new commit?
   Click **"Redeploy now"** on its detail page instead of waiting.
7. **"Resync IP"** re-runs `tailscale ip -4 <tailscaleName>` and updates
   `resolvedIp` — the escape hatch for the (uncommon) case where a Pi's
   underlying Tailscale IP drifts. Every deploy/SSH operation always uses
   the last-resolved `resolvedIp`, never the name directly, so a stale IP
   is a visible, fixable state (surfaced via `Pi.lastActionError`) rather
   than a silent connection failure.

The deployer also creates a **separate Docker container pair per `ACTIVE`
Pi** — `beehive-gds-<piId>` and `beehive-decoder-<piId>`, both from a
`beehive-gds:latest` image the deployer builds itself
(`docker build -t beehive-gds:latest .` in `../beehive-project`, via
`buildGdsImage()`/`ensureGdsImage()` in `scripts/deployer.ts` — run
whenever `origin/main` moves, and once up front if the image doesn't
exist yet) — rather than one shared GDS multiple Pis would have to connect
into (`reconcileDockerContainers()`). Each Pi's GDS listens on its own
`assignedPort` (comm link) and `assignedPort + 10000` (web GUI), with its
own `../beehive-project/DpCat/<piId>/` and `logs/<piId>/` on disk so
multiple Pis' data products and logs never collide. A Pi that's `DISABLED`
has its containers torn down on the next reconcile pass.

Run the deployer with `pnpm deploy`, or install it as a persistent service
with [`tools/install_deployer_service.sh`](tools/install_deployer_service.sh)
(mirrors `../beehive-project/tools/install_watch_dpcat_decode_service.sh`'s
per-user systemd pattern). It needs `ssh-keygen`, `tailscale`, `docker`,
`git`, and `fprime-util` (from `beehive-project`'s own venv) all on
`PATH`/on disk, plus its own dedicated `beehive-project` checkout (see
`BEEHIVE_PROJECT_DIR` in `.env.example` — the deployer fast-forwards and
rebuilds this checkout on its own schedule, so don't point it at one you
also develop in by hand) and a reachable Postgres — if the rest of the
stack runs via `docker compose`, that means the `db` service's
loopback-only published port (see its `ports:` entry in
`docker-compose.yml`) rather than the internal Docker network `web`/
`watcher` use, since the deployer runs natively on the host.

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
- `lib/auth.ts` / `auth.config.ts` / `middleware.ts` — Auth.js config, split
  into a Node-only part (Prisma-backed Credentials provider) and an Edge-
  safe part middleware.ts can use — see `auth.config.ts`'s header for why
- `lib/require-admin.ts` — authorization check every admin Server Action
  calls, independent of middleware.ts's route-level gate
- `scripts/watcher.ts` — the standalone ingestion process (`pnpm watch`),
  one instance per Pi (`PI_ID`)
- `scripts/deployer.ts` — the fleet deployer (`pnpm deploy`) — SSH keypair
  generation, resolving/deploying to Pis, auto-redeploy on new commits, and
  per-Pi GDS/decoder Docker containers; see "Fleet management" above
- `scripts/create-admin.ts` — bootstraps the first admin account
- `lib/crypto.ts` — AES-256-GCM encrypt/decrypt for `Pi.sshPrivateKeyEncrypted`
- `tools/install_deployer_service.sh` — installs `scripts/deployer.ts` as a
  persistent per-user systemd service
- `app/api/readings/route.ts` — GET endpoint, readings for a `?boardId=`
  (defaults to the signed-in user's first board), scoped to boards they
  can see
- `app/components/Dashboard.tsx` / `WeightChart.tsx` — the dashboard UI
  (responsive; see the `sm:` breakpoints throughout for the mobile-vs-desktop
  differences)
- `app/admin/` — Server/Pi/board management, admin-only (see Data model
  above)
- `app/manifest.ts` / `public/sw.js` / `app/components/ServiceWorkerRegistration.tsx`
  — the PWA install manifest, service worker, and its client-side registration
- `prisma/schema.prisma` — `User`, `Pi`, `Board`, `WeightReading`,
  `ServerConfig`

## Future

Multi-board ingestion — this repo's watcher only handles one board per Pi
today, since the decoded telemetry JSON doesn't yet carry which
`WiiBoardManager` instance a reading came from (see `scripts/watcher.ts`'s
`resolveBoard()`) — isn't wired up yet. See `docs/planning.md` and the
"Multi-Pi / multi-board fleet management" plan for more.
