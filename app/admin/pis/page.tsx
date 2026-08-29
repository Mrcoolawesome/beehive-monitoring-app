import Link from "next/link";
import { prisma } from "@/lib/db";
import { deletePiAction } from "./actions";
import NewPiForm from "./NewPiForm";

// Without this, Next.js would statically prerender this page at build
// time (baking in whatever Pis/users existed then) instead of querying
// fresh on every request - it has no reason to know the Prisma calls
// below need to run per-request, since it doesn't touch cookies/headers
// itself. Same fix as app/page.tsx uses for the same reason.
export const dynamic = "force-dynamic";

export default async function PisPage() {
  const [pis, users] = await Promise.all([
    prisma.pi.findMany({
      include: {
        user: { select: { email: true } },
        boards: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">Pis</h1>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        {pis.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No Pis registered yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium">Tailscale name</th>
                  <th className="py-2 pr-4 font-medium">Port</th>
                  <th className="py-2 pr-4 font-medium">Boards</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pis.map((pi) => (
                  <tr
                    key={pi.id}
                    className="border-b border-[var(--gridline)] last:border-0"
                  >
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/pis/${pi.id}`}
                        className="text-[var(--series-1)] hover:underline"
                      >
                        {pi.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">
                      {pi.user.email}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">
                      {pi.tailscaleName}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-[var(--text-secondary)]">
                      {pi.assignedPort}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-[var(--text-secondary)]">
                      {pi.boards.length}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">
                      {pi.status}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deletePiAction.bind(null, pi.id)}>
                        <button
                          type="submit"
                          className="text-sm text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Add Pi
        </h2>
        {users.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No user accounts exist yet to assign a Pi to — have someone sign
            up first.
          </p>
        ) : (
          <NewPiForm users={users} />
        )}
      </div>
    </div>
  );
}
