import "dotenv/config";
import { existsSync } from "fs";
import { mkdir, rename } from "fs/promises";
import path from "path";
import chokidar from "chokidar";
import { prisma } from "../lib/db";
import { InvalidTelemetryError, parseTelemetryFile } from "../lib/ingest";

const WATCH_DIR = process.env.WATCH_DIR;
const PI_MAC_ADDRESS = process.env.PI_MAC_ADDRESS;

if (!WATCH_DIR) {
  throw new Error("WATCH_DIR is not set (check your .env file)");
}
if (!PI_MAC_ADDRESS) {
  throw new Error("PI_MAC_ADDRESS is not set (check your .env file)");
}

const PROCESSED_DIR = path.join(WATCH_DIR, "processed");
const FAILED_DIR = path.join(WATCH_DIR, "failed");

async function ensureDirs() {
  for (const dir of [WATCH_DIR!, PROCESSED_DIR, FAILED_DIR]) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

async function handleFile(filePath: string) {
  const fileName = path.basename(filePath);
  try {
    const session = await parseTelemetryFile(filePath);
    await prisma.weightReading.create({
      data: {
        timestamp: session.timestamp,
        averageWeight: session.averageWeightKg,
        piMacAddress: PI_MAC_ADDRESS!,
      },
    });
    await rename(filePath, path.join(PROCESSED_DIR, fileName));
    console.log(
      `[ingested] ${fileName} -> ${session.averageWeightKg.toFixed(2)}kg ` +
        `(${session.sampleCountUsed}/${session.sampleCountTotal} valid samples)`,
    );
  } catch (err) {
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
    cwd: WATCH_DIR,
    depth: 0,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", (relativePath) => {
    if (!relativePath.toLowerCase().endsWith(".json")) return;
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

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
