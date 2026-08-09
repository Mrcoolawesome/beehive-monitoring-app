// Turns a raw F' telemetry JSON file into a single averaged weight reading.
//
// F' archives a ~1-minute "session" of Wii Balance Board samples (usually 60
// of them, one per second) and downlinks it as one JSON file. Our job here is
// to pull the timestamp and the sample values out of that file's nested
// structure, throw out samples that are just sensor noise, and average what's
// left into one number we can store and chart.

import { readFile } from "fs/promises";
import { z } from "zod";

/**
 * Samples at or below this weight (kg) are treated as sensor noise — the Wii
 * Board's tare/warm-up reading at the start of a session — and excluded from
 * the average rather than dragging it down.
 */
export const MIN_VALID_WEIGHT_KG = 0.1;

// One entry in Records[0].Data.samples.values. F' includes a "type" field
// (e.g. "F32") alongside each value, but we don't need it — Zod just ignores
// fields we don't list, so extra metadata elsewhere in the payload is fine.
const SampleSchema = z.object({
  value: z.number(),
});

// Describes only the parts of the F' JSON payload we actually care about
// (see docs/planning.md for the full example payload). Everything else in
// the real file — packet descriptors, checksums, priorities, etc. — is
// simply ignored rather than validated, since Zod objects strip unknown
// keys by default.
const TelemetryPayloadSchema = z.object({
  Header: z.object({
    Time: z.object({
      seconds: z.number(),
      microseconds: z.number(),
    }),
  }),
  Records: z
    .array(
      z.object({
        Data: z.object({
          samples: z.object({
            values: z.array(SampleSchema),
          }),
        }),
      }),
    )
    .min(1), // at least one record — an empty Records array means a malformed file
});

// Thrown for any file that isn't usable: bad JSON, a payload that doesn't
// match the expected F' shape, or a session where every sample was noise.
// The watcher catches this specifically and routes the file to failed/
// instead of crashing.
export class InvalidTelemetryError extends Error {}

export interface ParsedWeightSession {
  timestamp: Date;
  averageWeightKg: number;
  sampleCountTotal: number;
  sampleCountUsed: number;
}

// Validates and averages an already-parsed JSON object (i.e. the output of
// JSON.parse). Split out from parseTelemetryFile below so the averaging
// logic can be unit-tested directly against plain objects, without needing
// a file on disk.
export function parseTelemetryPayload(raw: unknown): ParsedWeightSession {
  // Zod checks the shape of `raw` against TelemetryPayloadSchema above. If
  // it doesn't match (missing fields, wrong types, etc.) we bail out with a
  // descriptive error rather than letting a `TypeError: undefined` bubble up
  // from deep inside the averaging logic.
  const result = TelemetryPayloadSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidTelemetryError(
      `Malformed F' telemetry payload: ${result.error.message}`,
    );
  }

  const { Header, Records } = result.data;

  // F' splits the timestamp into whole seconds plus a microseconds
  // remainder. JS Date wants milliseconds, so seconds*1000 gets us to
  // milliseconds and microseconds/1000 converts the remainder the same way.
  const timestamp = new Date(
    Header.Time.seconds * 1000 + Header.Time.microseconds / 1000,
  );

  // F' only ever sends one record per file today (the WeightSessionRecord),
  // so we always read Records[0] — the schema above guarantees the array
  // has at least one entry.
  const allValues = Records[0].Data.samples.values.map((s) => s.value);

  // Drop the tare/warm-up noise (see MIN_VALID_WEIGHT_KG above) before
  // averaging, so an empty-board moment at the start of a session doesn't
  // drag the reported weight down.
  const validValues = allValues.filter((v) => v >= MIN_VALID_WEIGHT_KG);

  // If literally every sample was noise (e.g. a bench-test capture with
  // nothing on the board), there's no real weight to report — treat the
  // whole file as invalid rather than recording a bogus reading.
  if (validValues.length === 0) {
    throw new InvalidTelemetryError(
      "No valid weight samples found (all samples were zero/near-zero noise)",
    );
  }

  const averageWeightKg =
    validValues.reduce((sum, v) => sum + v, 0) / validValues.length;

  return {
    timestamp,
    averageWeightKg,
    sampleCountTotal: allValues.length,
    sampleCountUsed: validValues.length,
  };
}

// Reads a telemetry JSON file off disk and turns it into a weight session.
// This is what the watcher calls for each new file it sees.
export async function parseTelemetryFile(
  filePath: string,
): Promise<ParsedWeightSession> {
  const raw = await readFile(filePath, "utf-8");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    // A file F' is still in the middle of writing, or a truncated/corrupt
    // downlink, will fail here with a JSON syntax error rather than a Zod
    // validation error — worth a distinct message when debugging failed/.
    throw new InvalidTelemetryError(
      `Failed to parse JSON from ${filePath}: ${(err as Error).message}`,
    );
  }

  return parseTelemetryPayload(json);
}
