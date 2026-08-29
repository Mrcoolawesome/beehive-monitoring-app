import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import BoardsSection from "./BoardsSection";
import SshSetupSection from "./SshSetupSection";
import ReassignUserForm from "./ReassignUserForm";

// Matches the fixed number of WiiBoardManager instances the flight
// software declares (wiiBoardManager0..wiiBoardManager3) - see the "Multi-
// Pi / multi-board fleet management" plan's F' section.
const MAX_SLOTS = 4;

// See app/admin/pis/page.tsx's comment on the same line - same reasoning
// (a dynamic route segment like [id] is usually treated as dynamic by
// default, but explicit here rather than relying on that).
export const dynamic = "force-dynamic";

export default async function PiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [pi, users] = await Promise.all([
    prisma.pi.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true } },
        boards: { orderBy: { slotIndex: "asc" } },
      },
    }),
    prisma.user.findMany({
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);
  if (!pi) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">
        {pi.name}
      </h1>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-6">
        <dt className="text-[var(--text-muted)]">User</dt>
        <dd className="text-[var(--foreground)]">
          <ReassignUserForm piId={pi.id} currentUserId={pi.user.id} users={users} />
        </dd>
        <dt className="text-[var(--text-muted)]">Tailscale name</dt>
        <dd className="text-[var(--foreground)]">{pi.tailscaleName}</dd>
        <dt className="text-[var(--text-muted)]">Resolved IP</dt>
        <dd className="text-[var(--foreground)]">
          {pi.resolvedIp ?? "not resolved yet"}
        </dd>
        <dt className="text-[var(--text-muted)]">Port</dt>
        <dd className="tabular-nums text-[var(--foreground)]">
          {pi.assignedPort}
        </dd>
        <dt className="text-[var(--text-muted)]">Status</dt>
        <dd className="text-[var(--foreground)]">{pi.status}</dd>
        <dt className="text-[var(--text-muted)]">Last deployed</dt>
        <dd className="text-[var(--foreground)]">
          {pi.lastDeployedSha
            ? `${pi.lastDeployedSha.slice(0, 8)} (${pi.lastDeployedAt?.toLocaleString() ?? "?"})`
            : "never"}
        </dd>
      </dl>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          SSH setup
        </h2>
        <SshSetupSection
          piId={pi.id}
          sshUser={pi.sshUser}
          resolvedIp={pi.resolvedIp}
          sshPublicKey={pi.sshPublicKey}
          pendingAction={pi.pendingAction}
          lastActionError={pi.lastActionError}
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Boards
        </h2>
        <BoardsSection piId={pi.id} boards={pi.boards} maxSlots={MAX_SLOTS} />
      </div>
    </div>
  );
}
