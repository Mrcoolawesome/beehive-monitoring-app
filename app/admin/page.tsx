// Admin landing page - middleware.ts already guarantees only an ADMIN
// reaches this far.

import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function AdminPage() {
  const session = await auth();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">
        Admin
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        Signed in as {session?.user?.email} ({session?.user?.role}).
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/admin/server"
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--series-1-wash)] sm:flex-1"
        >
          <div className="font-medium text-[var(--foreground)]">Server</div>
          <div className="text-sm text-[var(--text-muted)]">
            The address every Pi connects to
          </div>
        </Link>
        <Link
          href="/admin/pis"
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--series-1-wash)] sm:flex-1"
        >
          <div className="font-medium text-[var(--foreground)]">Pis</div>
          <div className="text-sm text-[var(--text-muted)]">
            Register Pis, assign owners, manage boards
          </div>
        </Link>
      </div>
    </div>
  );
}
