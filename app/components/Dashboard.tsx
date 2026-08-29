// The main dashboard view: a "latest weight" stat tile plus a weight-over-
// time chart (with a table view as an alternative). This is a Client
// Component ("use client") because it needs browser-only features — state
// for the chart/table toggle, the board switcher, and a polling interval
// that keeps the data fresh without the user having to refresh the page.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import WeightChart, { type WeightDomain } from "./WeightChart";

// The shape of one row as it travels from the server (app/page.tsx) or the
// API route (app/api/readings/route.ts) down into this component.
export interface Reading {
  id: string;
  timestamp: string; // ISO string — see the comment in app/page.tsx for why
  averageWeight: number;
}

// One board this signed-in user can view — every Pi assigned to them
// (Pi.userId), across all of that Pi's boards. See app/page.tsx.
export interface BoardOption {
  id: string;
  label: string;
  piName: string;
}

// How often to re-fetch readings from the API while the page is open. F'
// sessions land every few minutes at most, so polling every 30s is frequent
// enough to feel "live" without hammering the server.
const POLL_INTERVAL_MS = 30_000;

// Preset time windows for the chart/table, applied against "now" at render
// time. "all" (ms: null) means no filtering at all — the full history.
// Filtering happens client-side rather than as an API query param: at this
// project's scale (a handful of sessions a day) shipping the full history
// to the browser and slicing it there is simpler than keeping an API route,
// the SSR query in page.tsx, and client state all in sync over a `range`
// param, and it keeps every range change instant with no network round trip.
type TimeRangeKey = "24h" | "7d" | "30d" | "all" | "custom";

// A short, filename-safe token describing the selected range, so a
// downloaded CSV's name alone tells you what's in it without opening it —
// "hive-weight-24h.csv" vs. "hive-weight-2026-08-01T00-00_to_2026-08-15T00-00.csv".
// datetime-local values (e.g. "2026-08-15T10:30") are already filename-safe
// except for the colon, which most filesystems reject.
function rangeFilenameToken(
  key: TimeRangeKey,
  customFrom: string,
  customTo: string,
) {
  if (key !== "custom") return key;
  const from = (customFrom || "start").replaceAll(":", "-");
  const to = (customTo || "now").replaceAll(":", "-");
  return `${from}_to_${to}`;
}

// Builds a CSV from readings and triggers a browser download of it. Kept as
// a plain function (not a hook) since it has no reactive state of its own —
// it's only ever called from the click handler below, with whatever
// readings/filename are current at that moment.
function downloadReadingsCsv(readings: Reading[], filename: string) {
  // Neither field can contain a comma or quote (timestamp is a fixed ISO
  // format, averageWeight is a plain number), so no CSV quoting/escaping is
  // needed here.
  const lines = [
    "timestamp,averageWeightKg",
    ...readings.map((r) => `${r.timestamp},${r.averageWeight}`),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  // No visible <a> in the DOM triggers a download on its own — browsers
  // only honor the `download` attribute on a real click, so one gets
  // created, clicked, and torn down immediately rather than needing a
  // permanent hidden link sitting in the page.
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const TIME_RANGE_PRESETS: { key: TimeRangeKey; label: string; ms: number }[] = [
  { key: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
];

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
  boards,
  initialBoardId,
  initialReadings,
}: {
  boards: BoardOption[];
  initialBoardId: string | null;
  initialReadings: Reading[];
}) {
  // Which board's readings are currently shown. Only meaningful when there's
  // more than one board to choose from - see the selector in the header
  // below, which only renders in that case.
  const [selectedBoardId, setSelectedBoardId] = useState(initialBoardId);

  // Seeded from the server-rendered data (app/page.tsx) so the page shows
  // real data immediately on load, then kept fresh by the polling effect
  // below (and replaced outright on a board switch).
  const [readings, setReadings] = useState(initialReadings);
  const [showTable, setShowTable] = useState(false);

  // Defaults to "all" — until there's real history, there's nothing to
  // usefully restrict, and someone with an empty dashboard shouldn't have
  // to notice a range filter is on before their first reading shows up.
  const [timeRangeKey, setTimeRangeKey] = useState<TimeRangeKey>("all");
  // Held as the raw `<input type="datetime-local">` strings (not Dates) so
  // the inputs stay controlled and round-trip cleanly — only parsed into
  // timestamps inside the filter below.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Y-axis bounds for the chart. Empty string means "auto" (Recharts fits
  // the axis to whatever data is visible) — kept as strings rather than
  // `number | null` so the inputs can hold intermediate typing states like
  // "-" or "12." without fighting the user mid-keystroke.
  const [minWeight, setMinWeight] = useState("");
  const [maxWeight, setMaxWeight] = useState("");

  // The "current time" the preset ranges (24h/7d/30d) are measured back
  // from. `Date.now()` can't be called directly in the memo below — render
  // has to be a pure function of props/state, and Date.now() is impure (two
  // calls in the same render can return different values) — so it's read
  // once via this lazy initializer (allowed to be impure; it only runs
  // once, on mount) and refreshed on the same cadence as the reading poll,
  // since the cutoffs only need "roughly now," not sub-second, precision.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Readings restricted to the selected time range. Only affects the chart
  // and table below — the "Latest weight" stat tile intentionally keeps
  // reading from the unfiltered `readings` array, since it's meant to show
  // hive status right now regardless of what window someone's looking at.
  const visibleReadings = useMemo(() => {
    if (timeRangeKey === "all") return readings;

    let sinceMs = -Infinity;
    let untilMs = Infinity;
    if (timeRangeKey === "custom") {
      if (customFrom) sinceMs = new Date(customFrom).getTime();
      if (customTo) untilMs = new Date(customTo).getTime();
    } else {
      const preset = TIME_RANGE_PRESETS.find((p) => p.key === timeRangeKey);
      sinceMs = now - (preset?.ms ?? 0);
    }

    return readings.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= sinceMs && t <= untilMs;
    });
  }, [readings, timeRangeKey, customFrom, customTo, now]);

  const weightDomain: WeightDomain = [
    minWeight === "" ? "auto" : Number(minWeight),
    maxWeight === "" ? "auto" : Number(maxWeight),
  ];
  const hasWeightRange = minWeight !== "" || maxWeight !== "";

  // Fetches readings for one board. Shared by the polling effect below and
  // the board-switcher's onChange, rather than each keeping its own copy of
  // this fetch logic.
  const fetchReadings = useCallback(async (boardId: string) => {
    try {
      const res = await fetch(
        `/api/readings?boardId=${encodeURIComponent(boardId)}`,
      );
      if (!res.ok) return;
      const body = await res.json();
      setReadings(body.readings);
    } catch {
      // A transient network hiccup shouldn't blank out the chart — just
      // keep showing the last successful render and try again next tick.
    }
  }, []);

  // Re-fetches readings from /api/readings every POLL_INTERVAL_MS so new
  // sessions the watcher ingests show up without a manual page refresh.
  // Skipped entirely when there's no board selected (an account with no
  // boards assigned yet never had anything to poll for in the first place).
  useEffect(() => {
    if (!selectedBoardId) return;
    const interval = setInterval(
      () => fetchReadings(selectedBoardId),
      POLL_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [selectedBoardId, fetchReadings]);

  function handleBoardChange(boardId: string) {
    setSelectedBoardId(boardId);
    // Switching boards should feel instant, not wait for the next poll
    // tick (up to 30s away) to show the new board's data.
    void fetchReadings(boardId);
  }

  // Readings come back sorted oldest-first (see the API route), so the
  // most recent one is simply the last element.
  const latest = readings[readings.length - 1];
  const selectedBoard = boards.find((b) => b.id === selectedBoardId);

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
        {boards.length > 1 ? (
          // A picker instead of static text once there's more than one
          // board to choose from - single-board accounts (the common case
          // today) keep the simpler plain-text line below instead.
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            Board
            <select
              value={selectedBoardId ?? ""}
              onChange={(e) => handleBoardChange(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.piName} — {b.label}
                </option>
              ))}
            </select>
          </label>
        ) : selectedBoard ? (
          <p className="text-sm text-[var(--text-muted)]">
            {selectedBoard.piName} — {selectedBoard.label}
          </p>
        ) : null}
      </header>

      {boards.length === 0 ? (
        // No Pi/board is assigned to this account yet - nothing to chart,
        // table, or poll for, so the rest of the dashboard (which all
        // assumes a selected board) never renders.
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)] sm:p-6">
          No hive is assigned to your account yet. An admin needs to add one
          for you in the admin panel.
        </div>
      ) : (
        <>
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
              // Shown before the watcher has ever successfully ingested a
              // file for this board — e.g. right after a fresh setup.
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
                  text) since these are the interactive controls on a page
                  that's otherwise just for reading — worth making them easy to
                  tap accurately on a phone. */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    downloadReadingsCsv(
                      visibleReadings,
                      `hive-weight-${rangeFilenameToken(timeRangeKey, customFrom, customTo)}.csv`,
                    )
                  }
                  disabled={visibleReadings.length === 0}
                  className="-mx-2 -my-1 rounded-md px-2 py-1 text-sm text-[var(--series-1)] hover:underline active:bg-[var(--series-1-wash)] disabled:text-[var(--text-muted)] disabled:hover:no-underline"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setShowTable((v) => !v)}
                  className="-mx-2 -my-1 rounded-md px-2 py-1 text-sm text-[var(--series-1)] hover:underline active:bg-[var(--series-1-wash)]"
                >
                  {showTable ? "Show chart" : "Show table"}
                </button>
              </div>
            </div>

            {/* Range controls. Time range affects both the chart and the table
                below (it's a real filter on which readings are in view), while
                the weight range only makes sense for the chart — it's a Y-axis
                display bound, not a reason to exclude table rows — so those
                inputs only render when the chart is what's showing. */}
            <div className="mb-3 flex flex-col gap-2 border-b border-[var(--gridline)] pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1">
                {TIME_RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => setTimeRangeKey(preset.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      timeRangeKey === preset.key
                        ? "bg-[var(--series-1)] text-white"
                        : "text-[var(--text-muted)] hover:bg-[var(--series-1-wash)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  onClick={() => setTimeRangeKey("all")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    timeRangeKey === "all"
                      ? "bg-[var(--series-1)] text-white"
                      : "text-[var(--text-muted)] hover:bg-[var(--series-1-wash)] hover:text-[var(--foreground)]"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setTimeRangeKey("custom")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    timeRangeKey === "custom"
                      ? "bg-[var(--series-1)] text-white"
                      : "text-[var(--text-muted)] hover:bg-[var(--series-1-wash)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Custom
                </button>
              </div>

              {timeRangeKey === "custom" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                  <label className="flex items-center gap-1">
                    From
                    <input
                      type="datetime-local"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    To
                    <input
                      type="datetime-local"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                </div>
              )}

              {!showTable && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                  <label className="flex items-center gap-1">
                    Min kg
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      placeholder="auto"
                      value={minWeight}
                      onChange={(e) => setMinWeight(e.target.value)}
                      className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Max kg
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      placeholder="auto"
                      value={maxWeight}
                      onChange={(e) => setMaxWeight(e.target.value)}
                      className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]"
                    />
                  </label>
                  {hasWeightRange && (
                    <button
                      onClick={() => {
                        setMinWeight("");
                        setMaxWeight("");
                      }}
                      className="text-[var(--series-1)] hover:underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
              )}
            </div>

            {readings.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-[var(--text-muted)] sm:h-[360px]">
                No data yet
              </div>
            ) : visibleReadings.length === 0 ? (
              // Distinct from the "no data yet" case above — the watcher has
              // ingested readings, they just don't fall inside the selected
              // time range, which is a much more common thing to hit (picking
              // a Custom range with nothing in it) than a truly empty dashboard.
              <div className="flex h-[280px] items-center justify-center text-[var(--text-muted)] sm:h-[360px]">
                No readings in this range
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
                    {[...visibleReadings]
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
              <WeightChart
                readings={visibleReadings}
                weightDomain={weightDomain}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
