// The time-series line chart itself, built on Recharts. Single series (one
// hive's weight over time), so per the project's charting conventions there's
// no legend — the "Weight over time" card title in Dashboard.tsx already
// says what's plotted — but there is a custom hover tooltip with a crosshair,
// since a chart with no way to read exact values is a picture, not a tool.

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

// X-axis tick labels adapt to how much time the chart spans: once there's
// more than a day of data, showing the time of day (e.g. "2:30 PM") stops
// being useful and the date (e.g. "Aug 9") becomes what actually
// distinguishes one tick from the next.
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

// The tooltip always shows both date and time, regardless of the chart's
// span — unlike the axis ticks, there's room for the full detail here since
// only one tooltip is visible at a time.
function formatTooltipTimestamp(ts: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

// Custom hover tooltip, styled to match the app's design tokens (see
// app/globals.css) instead of Recharts' plain default box. Recharts calls
// this with `active`/`payload` itself whenever the pointer is over the
// chart — see the <Tooltip content={...}> usage below.
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
        {/* A short line-key in the series color, echoing the chart's line
            rather than the value's text itself carrying color — see the
            "text never wears the data color" rule in the project's
            charting conventions. */}
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
  // Recharts wants numeric X values (milliseconds since epoch) to treat the
  // axis as a true continuous time scale, so ISO timestamp strings get
  // converted here rather than passed through as-is.
  const data = readings.map((r) => ({
    timestamp: new Date(r.timestamp).getTime(),
    averageWeight: r.averageWeight,
  }));

  // How much time the whole chart covers, used to decide the axis tick
  // format above (date-only vs. time-only).
  const spanMs =
    data.length > 1 ? data[data.length - 1].timestamp - data[0].timestamp : 0;

  return (
    // The height has to live on this wrapping div (via Tailwind's
    // responsive `h-*` classes) rather than as a fixed number passed
    // straight to ResponsiveContainer, since that prop only accepts one
    // static value — it has no way to know it should be shorter on a phone
    // screen than on desktop.
    <div className="h-[280px] sm:h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
          {/* Horizontal gridlines only — vertical ones would compete with the
              crosshair cursor below and add clutter without adding meaning. */}
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
            minTickGap={40} // avoids overlapping labels when there are many close-together readings
          />
          <YAxis
            dataKey="averageWeight"
            domain={["auto", "auto"]}
            tickFormatter={(v) => `${v} kg`}
            stroke="var(--baseline)"
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            // Trimmed from a more generous 64px — on a ~320px-wide phone in
            // portrait, every pixel the axis takes is a pixel the actual
            // line doesn't get. 52px still comfortably fits "62 kg".
            width={52}
          />
          <Tooltip
            content={<TooltipContent />}
            // The vertical line that tracks the pointer and snaps to the
            // nearest reading, so the reader aims at a moment in time rather
            // than trying to land exactly on the (thin) line itself.
            cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="averageWeight"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false} // no dot on every point — that would be visual noise; the tooltip carries per-point detail instead
            activeDot={{
              r: 4,
              fill: "var(--series-1)",
              stroke: "var(--surface)", // a ring in the surface color keeps the dot legible where it crosses the line
              strokeWidth: 2,
            }}
            isAnimationActive={false} // instant redraw on the 30s poll, rather than re-animating the whole line in from zero each time
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
