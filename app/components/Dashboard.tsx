"use client";

import { useEffect, useState } from "react";
import WeightChart from "./WeightChart";

export interface Reading {
  id: string;
  timestamp: string;
  averageWeight: number;
}

const POLL_INTERVAL_MS = 30_000;

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

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
  const [readings, setReadings] = useState(initialReadings);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/readings?mac=${encodeURIComponent(mac)}`);
        if (!res.ok) return;
        const body = await res.json();
        setReadings(body.readings);
      } catch {
        // Transient fetch failure — keep showing the last good render.
      }
    };
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [mac]);

  const latest = readings[readings.length - 1];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          Hive Weight Monitor
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Pi {mac}
        </p>
      </header>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-sm text-[var(--text-secondary)]">
          Latest weight
        </div>
        {latest ? (
          <>
            <div className="mt-1 text-5xl font-semibold tabular-nums text-[var(--foreground)]">
              {latest.averageWeight.toFixed(2)}
              <span className="ml-2 text-2xl text-[var(--text-muted)]">
                kg
              </span>
            </div>
            <div className="mt-2 text-sm text-[var(--text-muted)]">
              {formatDateTime(latest.timestamp)} &middot;{" "}
              {formatRelative(latest.timestamp)}
            </div>
          </>
        ) : (
          <div className="mt-1 text-lg text-[var(--text-muted)]">
            No readings yet — waiting on the watcher to ingest a session.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            Weight over time
          </h2>
          <button
            onClick={() => setShowTable((v) => !v)}
            className="text-sm text-[var(--series-1)] hover:underline"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>

        {readings.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-[var(--text-muted)]">
            No data yet
          </div>
        ) : showTable ? (
          <div className="max-h-[360px] overflow-y-auto">
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
