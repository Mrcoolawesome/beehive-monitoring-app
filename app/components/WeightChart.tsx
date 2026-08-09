"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reading } from "./Dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatAxisTick(ts: number, spanMs: number) {
  const date = new Date(ts);
  if (spanMs > DAY_MS) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTooltipTimestamp(ts: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function TooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number; payload: { timestamp: number } }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0];

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
        {formatTooltipTimestamp(point.payload.timestamp)}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 2,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 2,
            background: "var(--series-1)",
            borderRadius: 1,
          }}
        />
        <span
          style={{
            color: "var(--foreground)",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {point.value.toFixed(2)} kg
        </span>
      </div>
    </div>
  );
}

export default function WeightChart({ readings }: { readings: Reading[] }) {
  const data = readings.map((r) => ({
    timestamp: new Date(r.timestamp).getTime(),
    averageWeight: r.averageWeight,
  }));

  const spanMs =
    data.length > 1 ? data[data.length - 1].timestamp - data[0].timestamp : 0;

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={data} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid
          vertical={false}
          stroke="var(--gridline)"
          strokeDasharray="0"
        />
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ts) => formatAxisTick(ts, spanMs)}
          stroke="var(--baseline)"
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "var(--baseline)" }}
          minTickGap={40}
        />
        <YAxis
          dataKey="averageWeight"
          domain={["auto", "auto"]}
          tickFormatter={(v) => `${v} kg`}
          stroke="var(--baseline)"
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          content={<TooltipContent />}
          cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="averageWeight"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{
            r: 4,
            fill: "var(--series-1)",
            stroke: "var(--surface)",
            strokeWidth: 2,
          }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
