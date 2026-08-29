// Shared nav for every /admin/* page. middleware.ts already blocks a
// non-admin from reaching any of these routes, so this layout doesn't
// re-check that itself - it's purely presentational.

import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 py-3 text-sm sm:px-6">
          <Link
            href="/admin"
            className="font-medium text-[var(--foreground)]"
          >
            Admin
          </Link>
          <Link
            href="/admin/server"
            className="text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          >
            Server
          </Link>
          <Link
            href="/admin/pis"
            className="text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          >
            Pis
          </Link>
          <Link
            href="/"
            className="ml-auto text-[var(--series-1)] hover:underline"
          >
            Dashboard
          </Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
