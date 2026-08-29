"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createBoardAction, deleteBoardAction } from "./actions";

interface BoardRow {
  id: string;
  label: string;
  bluetoothMac: string;
  slotIndex: number;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Adding…" : "Add board"}
    </button>
  );
}

export default function BoardsSection({
  piId,
  boards,
  maxSlots,
}: {
  piId: string;
  boards: BoardRow[];
  maxSlots: number;
}) {
  const [error, formAction] = useActionState(createBoardAction, undefined);

  const usedSlots = new Set(boards.map((b) => b.slotIndex));
  const availableSlots = Array.from({ length: maxSlots }, (_, i) => i).filter(
    (i) => !usedSlots.has(i),
  );

  return (
    <div className="flex flex-col gap-4">
      {boards.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No boards yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="py-2 pr-4 font-medium">Slot</th>
                <th className="py-2 pr-4 font-medium">Label</th>
                <th className="py-2 pr-4 font-medium">Bluetooth MAC</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-[var(--gridline)] last:border-0"
                >
                  <td className="py-2 pr-4 tabular-nums text-[var(--text-secondary)]">
                    {b.slotIndex}
                  </td>
                  <td className="py-2 pr-4 text-[var(--foreground)]">
                    {b.label}
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-[var(--text-secondary)]">
                    {b.bluetoothMac}
                  </td>
                  <td className="py-2 text-right">
                    <form action={deleteBoardAction.bind(null, piId, b.id)}>
                      <button
                        type="submit"
                        className="text-sm text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {availableSlots.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          All {maxSlots} board slots are in use.
        </p>
      ) : (
        <form
          action={formAction}
          className="flex flex-col gap-3 border-t border-[var(--gridline)] pt-4"
        >
          <input type="hidden" name="piId" value={piId} />
          <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
            Label
            <input
              type="text"
              name="label"
              required
              placeholder="e.g. Hive 3 board"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
            Bluetooth MAC
            <input
              type="text"
              name="bluetoothMac"
              required
              placeholder="00:1F:32:22:03:BF"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-[var(--foreground)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
            Slot
            <select
              name="slotIndex"
              required
              defaultValue={availableSlots[0]}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
            >
              {availableSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
          <SubmitButton />
        </form>
      )}
    </div>
  );
}
