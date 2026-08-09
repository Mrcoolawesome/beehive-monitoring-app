import { readFile } from "fs/promises";
import { z } from "zod";

/**
 * Samples at or below this weight (kg) are treated as sensor noise — the Wii
 * Board's tare/warm-up reading at the start of a session — and excluded from
 * the average rather than dragging it down.
 */
export const MIN_VALID_WEIGHT_KG = 0.1;

const SampleSchema = z.object({
  value: z.number(),
});

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
    .min(1),
});

export class InvalidTelemetryError extends Error {}

export interface ParsedWeightSession {
  timestamp: Date;
  averageWeightKg: number;
  sampleCountTotal: number;
  sampleCountUsed: number;
}

export function parseTelemetryPayload(raw: unknown): ParsedWeightSession {
  const result = TelemetryPayloadSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidTelemetryError(
      `Malformed F' telemetry payload: ${result.error.message}`,
    );
  }

  const { Header, Records } = result.data;
  const timestamp = new Date(
    Header.Time.seconds * 1000 + Header.Time.microseconds / 1000,
  );

  const allValues = Records[0].Data.samples.values.map((s) => s.value);
  const validValues = allValues.filter((v) => v >= MIN_VALID_WEIGHT_KG);

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

export async function parseTelemetryFile(
  filePath: string,
): Promise<ParsedWeightSession> {
  const raw = await readFile(filePath, "utf-8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new InvalidTelemetryError(
      `Failed to parse JSON from ${filePath}: ${(err as Error).message}`,
    );
  }
  return parseTelemetryPayload(json);
}
