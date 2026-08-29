import { prisma } from "@/lib/db";
import ServerConfigForm from "./ServerConfigForm";

// See app/admin/pis/page.tsx's comment on the same line - same reasoning.
export const dynamic = "force-dynamic";

export default async function ServerConfigPage() {
  const config = await prisma.serverConfig.findFirst();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">
        Server
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        The address every Pi&apos;s flight software connects to (
        <code>-a &lt;host&gt;</code>), baked into that Pi&apos;s systemd
        service the next time it&apos;s deployed.
      </p>
      <ServerConfigForm currentHost={config?.host ?? ""} />
    </div>
  );
}
