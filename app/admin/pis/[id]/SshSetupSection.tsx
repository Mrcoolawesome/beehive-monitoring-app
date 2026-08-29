"use client";

import { useFormStatus } from "react-dom";
import {
  requestResyncIpAction,
  requestInitialSetupAction,
  requestRedeployAction,
} from "./actions";

function ActionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--gridline)] disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function SshSetupSection({
  piId,
  sshUser,
  resolvedIp,
  sshPublicKey,
  pendingAction,
  lastActionError,
}: {
  piId: string;
  sshUser: string;
  resolvedIp: string | null;
  sshPublicKey: string | null;
  // "SCAN_FOR_BOARDS" is a real PiPendingAction value but not one this
  // section renders anything for (BoardsSection has its own indicator for
  // it) - included here so the page can pass pi.pendingAction straight
  // through without narrowing it first.
  pendingAction:
    | "RESYNC_IP"
    | "INITIAL_SETUP"
    | "REDEPLOY"
    | "SCAN_FOR_BOARDS"
    | null;
  lastActionError: string | null;
}) {
  const target = resolvedIp ?? "<not resolved yet>";

  return (
    <div className="flex flex-col gap-3">
      {!sshPublicKey ? (
        <p className="text-sm text-[var(--text-muted)]">
          Generating an SSH keypair for this Pi — scripts/deployer.ts picks up
          newly-registered Pis every few seconds. Refresh shortly.
        </p>
      ) : (
        <>
          <div>
            <p className="mb-1 text-sm text-[var(--text-secondary)]">
              1. Install this public key on the Pi (one-time, from a machine
              that already has access):
            </p>
            <pre className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-xs text-[var(--foreground)]">
              {`echo '${sshPublicKey}' | ssh ${sshUser}@${target} 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'`}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <form action={requestResyncIpAction.bind(null, piId)}>
              <ActionButton label="Resync IP" pendingLabel="Requesting…" />
            </form>
            <form action={requestInitialSetupAction.bind(null, piId)}>
              <ActionButton
                label="Run initial setup"
                pendingLabel="Requesting…"
              />
            </form>
            <form action={requestRedeployAction.bind(null, piId)}>
              <ActionButton label="Redeploy now" pendingLabel="Requesting…" />
            </form>
            {pendingAction && pendingAction !== "SCAN_FOR_BOARDS" && (
              <span className="text-sm text-[var(--text-muted)]">
                {
                  {
                    RESYNC_IP: "Resync requested",
                    INITIAL_SETUP: "Initial setup requested",
                    REDEPLOY: "Redeploy requested",
                  }[pendingAction]
                }{" "}
                — deployer.ts will pick this up shortly…
              </span>
            )}
          </div>

          {lastActionError && (
            <p className="text-sm text-red-500" role="alert">
              Last attempt failed: {lastActionError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
