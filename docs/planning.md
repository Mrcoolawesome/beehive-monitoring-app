# Project Planning Document: Beehive F' Telemetry Web Monitor

This is the original planning document that kicked off the project, kept here
for reference. See the root `README.md` for the actual as-built setup/run
instructions, and the "Decisions" section at the bottom of this file for the
places where implementation diverged from or resolved ambiguity in the plan
below.

## 1. Project Overview
This project is a local web application designed to monitor beehive weight telemetry. The data is gathered by a repurposed Wii Balance Board connected to a Raspberry Pi running NASA's F Prime (F') framework.

F' downlinks telemetry data and saves it as JSON files on the local server. This web application will monitor a hardcoded directory for these JSON files, parse the weight data, calculate the average weight for that session, store it in a local database, and present it on a time-series chart.

## 2. Tech Stack (Simplified T3)
The application will be built using a modified T3 stack pattern, running locally on a personal server:
*   **Framework:** Next.js with React
*   **Language:** TypeScript
*   **Styling:** Tailwind CSS
*   **ORM:** Prisma
*   **Database:** PostgreSQL (Local)
*   *Note on Auth:* For this initial version, **do not implement user accounts or NextAuth**. Authentication and user-access controls are out of scope.

## 3. Data Ingestion & Processing
The application needs a backend process (e.g., a cron job, a Node watcher, or Next.js API route triggered by a script) that does the following:
1.  **Directory Monitoring:** Watch a hardcoded local directory path where F Prime drops the telemetry JSON files.
2.  **JSON Parsing:** Read the file and extract the necessary telemetry and timing data (schema detailed below).
3.  **Data Transformation:** The JSON file contains a burst of raw weight samples (typically ~60 samples). The ingestion script must calculate the **average weight** of all valid samples in that specific file.
4.  **Database Storage:** Insert the calculated average weight, the timestamp, and a Pi identifier into the PostgreSQL database.

## 4. Database Schema (Prisma)
The database needs to track the source of the data to support future scaling (multiple beehives/Pis).
*   **Model:** `WeightReading`
    *   `id`: UUID / CUID
    *   `timestamp`: DateTime (Parsed from the F' JSON header)
    *   `averageWeight`: Float (Calculated in kg)
    *   `piMacAddress`: String (Used to identify which Raspberry Pi gathered the data, replacing user accounts for now)
    *   `createdAt`: DateTime

## 5. Frontend UI
The UI should be a simple, clean dashboard containing:
*   A **Time vs. Weight Chart** (using a library like Recharts or Chart.js).
*   The Y-axis represents the Average Weight (kg).
*   The X-axis represents Time.
*   The data displayed on the chart should be queried from the local PostgreSQL database, separated/filtered by the Pi's MAC address.

## 6. F Prime JSON Data Structure
Below is the exact schema of the JSON files that F Prime will generate. The ingestion logic must navigate this structure:

### Target Data Points:
*   **Timestamp:** Located at `Header.Time.seconds` (Epoch time) and `Header.Time.microseconds`.
*   **Weight Samples:** Located at `Records[0].Data.samples.values`. This is an array of objects.
    *   To get the average, iterate through `Records[0].Data.samples.values`, extract the `value` float (e.g., `55.43`), sum them, and divide by `Records[0].Data.sampleCount.value` (or the array length).

### Example JSON Payload:
```json
{
  "Header": {
    "Time": {
      "seconds": 1785707868,
      "microseconds": 249948
    }
  },
  "Records": [
    {
      "Record": {
        "record_name": "BeeDeployment.wiiBoardManager.WeightSessionRecord"
      },
      "Data": {
        "sampleCount": {
          "value": 60
        },
        "samples": {
          "values": [
            { "value": 0.0, "type": "F32" },
            { "value": 54.76900100708008, "type": "F32" },
            { "value": 55.4319953918457, "type": "F32" }
            // ... (up to 60 samples)
          ]
        }
      }
    }
  ]
}
```

The fprime project & repository lives in `../beehive-project` relative to this project. The plan is for this app to eventually pull that project in as a git submodule.

## Decisions

The plan above left a few things open, or turned out to need adjustment once checked against real F' output in `../beehive-project/DpCat/`. Recorded here so the "why" isn't lost:

- **File watching:** a persistent Node process (chokidar) watching the drop directory, rather than a cron/polling script or an API route that F' pushes to. Runs standalone via `pnpm watch`, separate from the Next.js server, since Next.js request/response handlers aren't meant to host long-lived background code.
- **`piMacAddress` source:** the real F' JSON payload (confirmed against actual `DpCat/*.json` files) has no MAC address field anywhere in it, and the filenames (`Dp_<record_id>_<seconds>_<microseconds>.json`) don't encode one either. Since only one Pi/hive exists today, this is a single hardcoded value from the `PI_MAC_ADDRESS` env var rather than something parsed per file. Revisit if a second hive comes online.
- **Post-ingestion file handling:** successfully ingested files move to `WATCH_DIR/processed/`; files that fail to parse or validate move to `WATCH_DIR/failed/`. This keeps a raw-data audit trail and guarantees a file is never double-counted, while still surfacing failures for manual review instead of silently dropping them.
- **Zero-value samples:** the plan's pseudocode averages every sample in the array, but real captures show the first sample (and sometimes many more) sitting at exactly `0.0` — the board's tare/warm-up reading before someone or something is actually standing on it. Samples at or below `MIN_VALID_WEIGHT_KG` (0.1 kg, see `lib/ingest.ts`) are excluded from the average. If every sample in a file is filtered out (e.g. a bench-test capture with nothing on the board), the whole file is treated as invalid and routed to `failed/` rather than recorded as a bogus zero-weight reading.
- **Mobile + PWA (added after the initial build):** the dashboard needed to work well on a phone and be installable as a home-screen app. Rather than pull in a framework plugin (e.g. `next-pwa`/Serwist), the manifest/service worker are hand-rolled (`app/manifest.ts`, `public/sw.js`) since the requirements are small and fixed: cache the static shell only, never the live weight data. The icon set (`public/icons/`, `app/icon.png`, `app/apple-icon.png`) is a simple honeycomb-cell mark generated with a one-off Python/Pillow script rather than a design tool, since no image-generation tooling (`sharp`, ImageMagick, etc.) was available in the dev environment — regenerate by adapting the same approach if the mark ever needs to change.
- **Docker Compose (added after the initial build):** to deploy quickly to a server, one image (`Dockerfile`) covers all three app roles — `web`, a one-shot `migrate` job, and `watcher` — run via different `command:` overrides in `docker-compose.yml`, rather than three separate images, since they're the same app and keeping one build avoids version drift between them. Two things only surfaced by actually running it end-to-end (see below): the official `postgres:18+` image now wants its volume mounted at `/var/lib/postgresql` rather than the old `.../data` convention; and the watcher container must run as the host user's UID/GID (`WATCH_UID`/`WATCH_GID` in `.env`, defaulting to 1000/1000), not root — running it as root worked, but left root-owned files inside the bind-mounted `WATCH_DIR` that the host user then couldn't clean up without `sudo`.
- **Shipping with `../beehive-project` (added after Docker Compose):** rather than converting that repo into a git submodule, `docker-compose.yml` uses Compose's `include:` to pull in its `docker-compose.yml` as-is — the two repos stay independently versioned, and `gds`/`decoder` (F´'s ground station + its `.fdp`→`.json` decoder) are defined once, in that repo, not duplicated here. `beehive-project` already had its own (uncommitted) `gds` Dockerfile/compose setup; the `decoder` service is new — it reuses the `gds` image rather than adding a second Dockerfile, with `tools/`, `build-artifacts/`, and `DpCat/` bind-mounted in read-only/read-write as needed. Testing this against the real pipeline surfaced two things: Python fully buffers stdout in a container by default, so the decoder script's `print()` calls never reached `docker logs` until `PYTHONUNBUFFERED=1` was set; and a native `systemctl --user` instance of the same decoder script was already running on the host from earlier work on that repo — harmless to run alongside the container (whichever polls a changed file first "wins," the other just no-ops), but redundant, so it was stopped/disabled in favor of the containerized one.
