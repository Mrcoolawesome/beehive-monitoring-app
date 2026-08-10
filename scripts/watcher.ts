// The ingestion watcher: a standalone, long-running process (run via
// `pnpm watch`) that watches WATCH_DIR for new F' telemetry JSON files and
// turns each one into a WeightReading row in Postgres.
//
// This runs separately from the Next.js web server on purpose — Next.js
// handles one HTTP request at a time and isn't meant to host a background
// process that sits there indefinitely watching a folder. Keep this running
// (systemd/pm2 in production — see README.md) alongside `pnpm dev`/`pnpm start`.

import "dotenv/config";
import { existsSync } from "fs";
import { mkdir, rename } from "fs/promises";
import path from "path";
import chokidar from "chokidar";
import { prisma } from "../lib/db";
import { InvalidTelemetryError, parseTelemetryFile } from "../lib/ingest";

// dotenv/config (imported above) loads .env for us, since this script runs
// standalone via tsx rather than through Next.js (which loads .env itself).
const WATCH_DIR = process.env.WATCH_DIR;
const PI_MAC_ADDRESS = process.env.PI_MAC_ADDRESS;

if (!WATCH_DIR) {
  throw new Error("WATCH_DIR is not set (check your .env file)");
}
if (!PI_MAC_ADDRESS) {
  throw new Error("PI_MAC_ADDRESS is not set (check your .env file)");
}

// Every ingested file ends up in one of these two subfolders of WATCH_DIR,
// so a glance at the filesystem shows what got processed vs. what needs
// manual attention, and so a file already handled is never picked up again
// (the watcher only looks at WATCH_DIR itself, not its subfolders).
const PROCESSED_DIR = path.join(WATCH_DIR, "processed");
const FAILED_DIR = path.join(WATCH_DIR, "failed");

// Creates WATCH_DIR/processed and WATCH_DIR/failed (and WATCH_DIR itself)
// if they don't already exist, so a fresh checkout works without any manual
// `mkdir` step.
async function ensureDirs() {
  for (const dir of [WATCH_DIR!, PROCESSED_DIR, FAILED_DIR]) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

// Handles exactly one telemetry file: parse it, write a WeightReading row if
// it's valid, then move the file out of WATCH_DIR so it's never reprocessed.
// Both the success and failure paths end with the file being moved — the
// only difference is which folder it lands in.
async function handleFile(filePath: string) {
  const fileName = path.basename(filePath);
  try {
    const session = await parseTelemetryFile(filePath);
    // upsert rather than create: the same source file can legitimately get
    // handed to this watcher more than once — e.g. a decoder upstream
    // (like beehive-project's tools/watch_dpcat_decode.py) redecoding a
    // .fdp it's already decoded, after something else moved its .json
    // output away. Same Pi + same timestamp is always the same reading
    // (F's header timestamp is microsecond-precision, one per session), so
    // re-ingesting it just overwrites the same row instead of creating a
    // duplicate one.
    await prisma.weightReading.upsert({
      where: {
        piMacAddress_timestamp: {
          piMacAddress: PI_MAC_ADDRESS!,
          timestamp: session.timestamp,
        },
      },
      create: {
        timestamp: session.timestamp,
        averageWeight: session.averageWeightKg,
        piMacAddress: PI_MAC_ADDRESS!,
      },
      update: {
        averageWeight: session.averageWeightKg,
      },
    });
    await rename(filePath, path.join(PROCESSED_DIR, fileName));
    console.log(
      `[ingested] ${fileName} -> ${session.averageWeightKg.toFixed(2)}kg ` +
        `(${session.sampleCountUsed}/${session.sampleCountTotal} valid samples)`,
    );
  } catch (err) {
    // InvalidTelemetryError means the file itself is the problem (bad JSON,
    // wrong shape, all-noise session) — show its message as-is since it's
    // already written to be readable. Anything else is unexpected (e.g. a
    // database error) and gets labeled as such so it's obviously different
    // from a routine bad-file rejection when scanning the logs.
    const message =
      err instanceof InvalidTelemetryError
        ? err.message
        : `Unexpected error: ${(err as Error).message}`;
    console.error(`[failed] ${fileName}: ${message}`);
    try {
      await rename(filePath, path.join(FAILED_DIR, fileName));
    } catch (moveErr) {
      console.error(
        `[failed] could not move ${fileName} into failed/: ${(moveErr as Error).message}`,
      );
    }
  }
}

async function main() {
  await ensureDirs();

  console.log(`Watching ${WATCH_DIR} for F' telemetry JSON files...`);
  console.log(`Tagging readings with piMacAddress=${PI_MAC_ADDRESS}`);

  const watcher = chokidar.watch(".", {
    // Watch WATCH_DIR's contents ("." relative to cwd) rather than passing
    // it as an absolute path, and filter for .json in the "add" handler
    // below instead of using a glob pattern like "*.json" here — chokidar 4+
    // dropped glob-string support, and passing one anyway doesn't error, it
    // just makes chokidar's internal directory scan misbehave (confirmed by
    // testing: it re-resolves paths against `cwd` on every scan pass,
    // growing the path each time until file operations start failing with
    // ENAMETOOLONG).
    cwd: WATCH_DIR,
    // depth: 0 means "only look at WATCH_DIR's direct contents" — it stops
    // chokidar from recursing into processed/ and failed/, which matters
    // because we move files into those folders ourselves and don't want the
    // watcher to see that as a new file to ingest.
    depth: 0,
    // Process files already sitting in WATCH_DIR when the watcher starts,
    // not just ones that show up after — otherwise restarting the watcher
    // would silently ignore anything F' dropped while it was down.
    ignoreInitial: false,
    // F' (or whatever copies the file into WATCH_DIR) writes the file over
    // some nonzero span of time. Without this, chokidar could fire "add" the
    // moment the file is created but before all its bytes have landed,
    // producing a truncated-JSON parse failure. Waiting for the file size to
    // stay stable for stabilityThreshold ms avoids that race.
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", (relativePath) => {
    if (!relativePath.toLowerCase().endsWith(".json")) return;
    // handleFile is async but we don't await it here — chokidar's "add"
    // event handler isn't async-aware, and awaiting would process files
    // strictly one at a time. `void` just tells TypeScript we're
    // intentionally not awaiting this promise.
    void handleFile(path.join(WATCH_DIR!, relativePath));
  });

  watcher.on("error", (err) => {
    console.error("Watcher error:", err);
  });
}

main().catch((err) => {
  console.error("Fatal error starting watcher:", err);
  process.exit(1);
});

// Close the database connection cleanly when the process is stopped (Ctrl+C
// locally, or a `systemctl stop` in production), rather than leaving the
// connection pool to time out on its own.
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
