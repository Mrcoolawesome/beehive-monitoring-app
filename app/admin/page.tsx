// Placeholder admin landing page - proves middleware.ts's route gate
// works end-to-end. Real content (Server/Pi/Board management) is Phase 3.

import { auth } from "@/lib/auth";

export default async function AdminPage() {
  // middleware.ts already guarantees only an ADMIN reaches this far, so
  // this is just for display, not an access check of its own.
  const session = await auth();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">
        Admin
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        Signed in as {session?.user?.email} ({session?.user?.role}).
      </p>
      <p className="text-sm text-[var(--text-muted)]">
        Server/Pi/board management coming next.
      </p>
    </div>
  );
}
