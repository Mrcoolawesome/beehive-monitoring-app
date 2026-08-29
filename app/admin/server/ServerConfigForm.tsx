"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateServerConfigAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export default function ServerConfigForm({
  currentHost,
}: {
  currentHost: string;
}) {
  const [error, formAction] = useActionState(
    updateServerConfigAction,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"
    >
      <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
        Host
        <input
          type="text"
          name="host"
          defaultValue={currentHost}
          placeholder="e.g. 100.122.230.118"
          required
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
        />
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
