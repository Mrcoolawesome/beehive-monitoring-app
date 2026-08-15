// Sign-in page. A Server Component (no "use client") so it can read
// `callbackUrl` straight from the URL search params - middleware.ts
// appends this when it redirects an unauthenticated visitor away from
// /admin, so signing in sends them back to where they were headed instead
// of always landing on the dashboard.

import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; created?: string }>;
}) {
  const { callbackUrl, created } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">
        Sign in
      </h1>
      {created && (
        <p className="rounded-md bg-[var(--series-1-wash)] px-3 py-2 text-sm text-[var(--foreground)]">
          Account created — sign in below.
        </p>
      )}
      <LoginForm callbackUrl={callbackUrl ?? "/"} />
      <p className="text-sm text-[var(--text-muted)]">
        Don&apos;t have an account?{" "}
        <a
          href="/signup"
          className="text-[var(--series-1)] hover:underline"
        >
          Sign up
        </a>
      </p>
    </div>
  );
}
