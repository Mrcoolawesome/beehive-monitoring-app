// The login form. Calls next-auth/react's client-side signIn() (a plain
// async helper, not dependent on <SessionProvider> - that's only needed
// for the useSession() hook, not for signIn()/signOut()) rather than a
// Server Action wrapping lib/auth.ts's signIn(). Client-side signIn() POSTs
// to the same /api/auth/callback/credentials route Auth.js's route handler
// serves, so it's the well-trodden path - a Server Action calling signIn()
// directly hit an error in local testing, but that turned out to be a
// stale dev server process left over from earlier testing (serving old
// bundled code from an unlinked log file), not a reproducible bug in the
// Server Action approach itself. Kept this version since it's the more
// standard pattern regardless.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      // Handle the redirect ourselves (via router.push below) instead of
      // letting signIn() do it - with redirect: true it never returns, so
      // there'd be no way to catch a failed login and show `error` instead.
      redirect: false,
    });

    if (result?.error) {
      // Every Credentials failure mode (unknown email, wrong password) maps
      // to the same generic message on purpose - distinguishing them would
      // tell an attacker which emails are registered.
      setError("Incorrect email or password.");
      setPending(false);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]"
        />
      </label>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
