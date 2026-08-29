"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { reassignPiUserAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--gridline)] disabled:opacity-50"
    >
      {pending ? "Saving…" : "Reassign"}
    </button>
  );
}

export default function ReassignUserForm({
  piId,
  currentUserId,
  users,
}: {
  piId: string;
  currentUserId: string;
  users: { id: string; email: string }[];
}) {
  const [error, formAction] = useActionState(reassignPiUserAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="piId" value={piId} />
      <select
        name="userId"
        defaultValue={currentUserId}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)]"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.email}
          </option>
        ))}
      </select>
      <SubmitButton />
      {error && (
        <p className="w-full text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
