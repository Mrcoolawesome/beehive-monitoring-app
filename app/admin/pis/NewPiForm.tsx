"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createPiAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Adding…" : "Add Pi"}
    </button>
  );
}

export default function NewPiForm({
  users,
}: {
  users: { id: string; email: string }[];
}) {
  const [error, formAction] = useActionState(createPiAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
        Name
        <input
          type="text"
          name="name"
          required
          placeholder="e.g. Backyard hive"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
        Tailscale name
        <input
          type="text"
          name="tailscaleName"
          required
          placeholder="e.g. beehive0"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
        Assign to
        <select
          name="userId"
          required
          defaultValue=""
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
        >
          <option value="" disabled>
            Select a user
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
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
  );
}
