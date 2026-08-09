// The main dashboard view: a "latest weight" stat tile plus a weight-over-
// time chart (with a table view as an alternative). This is a Client
// Component ("use client") because it needs browser-only features — state
// for the chart/table toggle, and a polling interval that keeps the data
// fresh without the user having to refresh the page.

"use client";

import { useEffect, useState } from "react";
import WeightChart from "./WeightChart";

// The shape of one row as it travels from the server (app/page.tsx) or the
// API route (app/api/readings/route.ts) down into this component.
export interface Reading {
  id: string;
  timestamp: string; // ISO string — see the comment in app/page.tsx for why
  averageWeight: number;
}

// How often to re-fetch readings from the API while the page is open. F'
// sessions land every few minutes at most, so polling every 30s is frequent
// enough to feel "live" without hammering the server.
const POLL_INTERVAL_MS = 30_000;

// "Aug 9, 2026, 2:30 PM" — used for the stat tile and the table rows.
function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// "3m ago" / "2h ago" / "5d ago" — a quick-glance freshness indicator next
// to the latest reading, so it's obvious at a look whether the watcher is
// still running or the last session was a while ago.
function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function Dashboard({
  mac,
  initialReadings,
}: {
  mac: string;
  initialReadings: Reading[];
}) {
  // Seeded from the server-rendered data (app/page.tsx) so the page shows
  // real data immediately on load, then kept fresh by the polling effect
  // below.
  const [readings, setReadings] = useState(initialReadings);
  const [showTable, setShowTable] = useState(false);

  // Re-fetches readings from /api/readings every POLL_INTERVAL_MS so new
  // sessions the watcher ingests show up without a manual page refresh.
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/readings?mac=${encodeURIComponent(mac)}`);
        if (!res.ok) return;
        const body = await res.json();
        setReadings(body.readings);
      } catch {
        // A transient network hiccup shouldn't blank out the chart — just
        // keep showing the last successful render and try again next tick.
      }
    };
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [mac]);

  // Readings come back sorted oldest-first (see the API route), so the
  // most recent one is simply the last element.
  const latest = readings[readings.length - 1];

  return (
    // Padding shrinks on narrow screens (the `sm:` variants only kick in at
    // 640px+) so phones get more usable width instead of the same desktop
    // margins squeezing the content. `max-w-4xl` still caps the width on
    // large screens so the chart/table don't stretch uncomfortably wide.
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:gap-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-[var(--foreground)] sm:text-2xl">
          Hive Weight Monitor
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Pi {mac}
        </p>
      </header>

      {/* Stat tile: the single most important number on the page. */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <div className="text-sm text-[var(--text-secondary)]">
          Latest weight
        </div>
        {latest ? (
          <>
            {/* text-4xl rather than 5xl below ~640px keeps "61.70 kg" from
                crowding the card's padding on the narrowest phone screens
                (~320px wide). */}
            <div className="mt-1 text-4xl font-semibold tabular-nums text-[var(--foreground)] sm:text-5xl">
              {latest.averageWeight.toFixed(2)}
              <span className="ml-2 text-xl text-[var(--text-muted)] sm:text-2xl">
                kg
              </span>
            </div>
            <div className="mt-2 text-sm text-[var(--text-muted)]">
              {formatDateTime(latest.timestamp)} &middot;{" "}
              {formatRelative(latest.timestamp)}
            </div>
          </>
        ) : (
          // Shown before the watcher has ever successfully ingested a file
          // for this Pi — e.g. right after a fresh setup.
          <div className="mt-1 text-lg text-[var(--text-muted)]">
            No readings yet — waiting on the watcher to ingest a session.
          </div>
        )}
      </div>

      {/* Chart card: the time-series view, with a raw-data table as an
          alternate view of the exact same readings (every value the chart
          shows is also reachable here, without needing to hover). */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            Weight over time
          </h2>
          {/* Padded to a comfortable touch target (not just underlined
              text) since this is the one interactive control on a page
              that's otherwise just for reading — worth making it easy to
              tap accurately on a phone. */}
          <button
            onClick={() => setShowTable((v) => !v)}
            className="-mx-2 -my-1 rounded-md px-2 py-1 text-sm text-[var(--series-1)] hover:underline active:bg-[var(--series-1-wash)]"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>

        {readings.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-[var(--text-muted)] sm:h-[360px]">
            No data yet
          </div>
        ) : showTable ? (
          // Newest-first in the table (opposite of the chart's oldest-first
          // order) since that's the more natural reading order for a log —
          // most recent reading at the top. overflow-x-auto is a safety net
          // in case a very narrow viewport can't fit both columns — the
          // table scrolls in its own box rather than the whole page.
          <div className="max-h-[280px] overflow-x-auto overflow-y-auto sm:max-h-[360px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Weight (kg)</th>
                </tr>
              </thead>
              <tbody>
                {[...readings]
                  .reverse()
                  .map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--gridline)] last:border-0"
                    >
                      <td className="py-2 text-[var(--text-secondary)]">
                        {formatDateTime(r.timestamp)}
                      </td>
                      <td className="py-2 tabular-nums text-[var(--foreground)]">
                        {r.averageWeight.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <WeightChart readings={readings} />
        )}
      </div>
    </div>
  );
}
