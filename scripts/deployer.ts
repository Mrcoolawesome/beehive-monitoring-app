// The fleet deployer: a standalone, long-running process that does
// everything the admin panel (running inside the `web` Docker container,
// with no ssh/tailscale binaries and no tailnet route of its own) asks for
// but can't perform itself - see the PiPendingAction comment in
// prisma/schema.prisma. Runs NATIVELY on the host (not in Docker), same
// reasoning as scripts/watcher.ts for being a separate process, plus: it
// needs the F' cross-compile toolchain and a real `beehive-project`
// checkout, which isn't worth re-baking into a container just for this.
//
// Two independent polling loops, run concurrently:
//   - fastLoop(): every FAST_POLL_MS, generates SSH keypairs for
//     newly-registered Pis and handles one pending admin action per tick.
//   - slowLoop(): every SLOW_POLL_MS, checks whether beehive-project's
//     origin/main has moved, rebuilds if so, and keeps every ACTIVE Pi's
//     binary and per-Pi GDS/decoder Docker containers up to date.
//
// Install with tools/install_deployer_service.sh, mirroring
// beehive-project's own install_beedeployment_service.sh /
// install_watch_dpcat_decode_service.sh pattern.

import "dotenv/config";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "../lib/db";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import type { Pi, Board } from "../app/generated/prisma/client";

const execFileAsync = promisify(execFile);

// A dedicated checkout, not whatever the operator happens to be poking at
// interactively - see tools/install_deployer_service.sh, which sets this
// up as part of installing the systemd service.
const BEEHIVE_PROJECT_DIR = process.env.BEEHIVE_PROJECT_DIR;
// Defaults to the project's own venv, matching every other tool in this
// stack (tools/watch_dpcat_decode.py, the manual fprime-util invocations
// all session).
const FPRIME_UTIL =
  process.env.FPRIME_UTIL_PATH ??
  (BEEHIVE_PROJECT_DIR
    ? path.join(BEEHIVE_PROJECT_DIR, "fprime-venv/bin/fprime-util")
    : undefined);

if (!BEEHIVE_PROJECT_DIR) {
  throw new Error("BEEHIVE_PROJECT_DIR is not set (check your .env file)");
}

const FAST_POLL_MS = 15_000;
const SLOW_POLL_MS = 5 * 60_000;

// The fixed number of WiiBoardManager instances the flight software
// declares (wiiBoardManager0..wiiBoardManager3) - see prisma/schema.prisma's
// Board model and the "Multi-Pi / multi-board fleet management" plan.
const SLOT_COUNT = 4;

// GDS web GUI port per Pi, derived from its assigned comm-link port so
// nothing extra needs to be stored - e.g. assignedPort 50001 (comm link)
// gets GUI port 60001. Only used for `docker run`'s port mapping; nothing
// in this app links to it today, it's just there so the admin can open it
// by hand if needed.
function guiPortFor(assignedPort: number): number {
  return assignedPort + 10_000;
}

function remoteDirFor(): string {
  // Fixed remote path on every Pi, rather than "wherever the admin
  // happened to scp things to" like the manual tools/deploy_to_pi.sh flow
  // - automation needs one predictable answer, not "ask the shell for
  // $HOME and hope it's consistent."
  return "/home/pi/beedeployment";
}

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd: opts.cwd,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

// ---------------------------------------------------------------------------
// SSH keypair generation
// ---------------------------------------------------------------------------

// Shells out to ssh-keygen rather than building an OpenSSH-format keypair
// with Node's own crypto module - guarantees the exact wire format ssh/scp
// and the Pi's authorized_keys expect, with zero risk of a hand-rolled
// encoding subtly not matching what real OpenSSH wants.
async function generateKeypair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "beehive-keygen-"));
  try {
    const keyPath = path.join(dir, "id_ed25519");
    await execFileAsync("ssh-keygen", [
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "beehive-deployer",
      "-f",
      keyPath,
    ]);
    const [privateKey, publicKey] = await Promise.all([
      readFile(keyPath, "utf8"),
      readFile(`${keyPath}.pub`, "utf8"),
    ]);
    return { privateKey, publicKey: publicKey.trim() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ensureKeypairs() {
  const pisNeedingKeys = await prisma.pi.findMany({
    where: { sshPrivateKeyEncrypted: null },
  });
  for (const pi of pisNeedingKeys) {
    try {
      const { privateKey, publicKey } = await generateKeypair();
      await prisma.pi.update({
        where: { id: pi.id },
        data: {
          sshPrivateKeyEncrypted: encryptSecret(privateKey),
          sshPublicKey: publicKey,
        },
      });
      console.log(`[keygen] generated SSH keypair for Pi ${pi.name} (${pi.id})`);
    } catch (err) {
      console.error(
        `[keygen] failed to generate keypair for Pi ${pi.name} (${pi.id}):`,
        (err as Error).message,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SSH/SCP helpers - a decrypted private key never touches disk longer than
// one operation needs it (written to a 0600 tempfile, used, then removed).
// ---------------------------------------------------------------------------

async function withPiKeyFile<T>(
  pi: Pi,
  fn: (keyPath: string) => Promise<T>,
): Promise<T> {
  if (!pi.sshPrivateKeyEncrypted) {
    throw new Error("Pi has no SSH keypair yet");
  }
  const dir = await mkdtemp(path.join(tmpdir(), "beehive-sshkey-"));
  const keyPath = path.join(dir, "id_ed25519");
  try {
    await writeFile(keyPath, decryptSecret(pi.sshPrivateKeyEncrypted), {
      mode: 0o600,
    });
    return await fn(keyPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// -o accept-new (not the default StrictHostKeyChecking): a Pi being
// registered for the first time has no known_hosts entry yet, and there's
// no interactive prompt to answer "yes" to in an unattended service -
// still refuses a HOST KEY THAT CHANGED (a real MITM-or-reimage signal),
// just not a host we've simply never seen before.
const SSH_OPTS = [
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ConnectTimeout=10",
];

function sshTarget(pi: Pi): string {
  if (!pi.resolvedIp) throw new Error("Pi has no resolvedIp yet");
  return `${pi.sshUser}@${pi.resolvedIp}`;
}

async function sshExec(pi: Pi, keyPath: string, remoteCmd: string) {
  return run("ssh", ["-i", keyPath, ...SSH_OPTS, sshTarget(pi), remoteCmd]);
}

async function scpUpload(pi: Pi, keyPath: string, localPath: string, remotePath: string) {
  await run("scp", ["-i", keyPath, ...SSH_OPTS, localPath, `${sshTarget(pi)}:${remotePath}`]);
}

// ---------------------------------------------------------------------------
// boards.txt generation - see beehive-project/BeeDeployment/boards.txt.example
// ---------------------------------------------------------------------------

function boardsTxtContent(boards: Board[]): string {
  const bySlot = new Map(boards.map((b) => [b.slotIndex, b]));
  const lines: string[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    lines.push(bySlot.get(slot)?.bluetoothMac ?? "");
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Deploying files to a Pi - reimplements (rather than shells out to)
// beehive-project's tools/deploy_to_pi.sh: that script is written for
// interactive use with the invoker's own ambient SSH identity/agent, with
// no way to hand it a specific keyfile for unattended use. Same
// ETXTBSY-safe "upload to temp name, rename into place" technique though -
// see that script's comment for why a direct overwrite fails.
// ---------------------------------------------------------------------------

async function uploadPiFiles(pi: Pi, boards: Board[], keyPath: string) {
  const remoteDir = remoteDirFor();
  const binary = path.join(
    BEEHIVE_PROJECT_DIR!,
    "build-artifacts/aarch64-linux/BeeDeployment/bin/BeeDeployment",
  );
  const bootSeq = path.join(BEEHIVE_PROJECT_DIR!, "BeeDeployment/boot_dp_downlink.bin");

  const boardsTxtPath = path.join(tmpdir(), `boards-${pi.id}.txt`);
  await writeFile(boardsTxtPath, boardsTxtContent(boards));

  try {
    await sshExec(pi, keyPath, `mkdir -p '${remoteDir}'`);
    await scpUpload(pi, keyPath, binary, `${remoteDir}/BeeDeployment.new`);
    await scpUpload(pi, keyPath, bootSeq, `${remoteDir}/boot_dp_downlink.bin.new`);
    await scpUpload(pi, keyPath, boardsTxtPath, `${remoteDir}/boards.txt.new`);
    await sshExec(
      pi,
      keyPath,
      `chmod +x '${remoteDir}/BeeDeployment.new' && ` +
        `mv '${remoteDir}/BeeDeployment.new' '${remoteDir}/BeeDeployment' && ` +
        `mv '${remoteDir}/boot_dp_downlink.bin.new' '${remoteDir}/boot_dp_downlink.bin' && ` +
        `mv '${remoteDir}/boards.txt.new' '${remoteDir}/boards.txt'`,
    );
  } finally {
    await rm(boardsTxtPath, { force: true });
  }
}

async function currentGitSha(): Promise<string> {
  return (await run("git", ["rev-parse", "HEAD"], { cwd: BEEHIVE_PROJECT_DIR })).trim();
}

async function getServerHost(): Promise<string> {
  const config = await prisma.serverConfig.findFirst();
  if (!config?.host) {
    throw new Error(
      "No ServerConfig.host set yet - set the GDS server address in /admin/server first",
    );
  }
  return config.host;
}

// ---------------------------------------------------------------------------
// Pending admin actions
// ---------------------------------------------------------------------------

async function handleResyncIp(pi: Pi) {
  const output = await run("tailscale", ["ip", "-4", pi.tailscaleName]);
  const ip = output.trim().split("\n")[0]?.trim();
  if (!ip) {
    throw new Error(`tailscale ip -4 ${pi.tailscaleName} returned nothing`);
  }
  await prisma.pi.update({
    where: { id: pi.id },
    data: { resolvedIp: ip, ipResolvedAt: new Date() },
  });
  console.log(`[resync] ${pi.name}: ${pi.tailscaleName} -> ${ip}`);
}

async function resyncIfNeeded(pi: Pi): Promise<Pi> {
  if (pi.resolvedIp) return pi;
  await handleResyncIp(pi);
  return (await prisma.pi.findUniqueOrThrow({ where: { id: pi.id } })) as Pi;
}

async function handleInitialSetup(pi: Pi) {
  const resolved = await resyncIfNeeded(pi);
  const boards = await prisma.board.findMany({ where: { piId: pi.id } });
  const gdsHost = await getServerHost();

  await withPiKeyFile(resolved, async (keyPath) => {
    await uploadPiFiles(resolved, boards, keyPath);

    // Reuse the actual install script (not a reimplementation of the
    // systemd unit) - it's meant to be run "on the Pi itself", so it's
    // scp'd over and run remotely with this Pi's port/host baked in as
    // args, same three args a human would pass by hand.
    const installScript = path.join(
      BEEHIVE_PROJECT_DIR!,
      "tools/install_beedeployment_service.sh",
    );
    await scpUpload(resolved, keyPath, installScript, `${remoteDirFor()}/install_beedeployment_service.sh`);
    // install_beedeployment_service.sh ends with `systemctl enable --now`,
    // which is a no-op on a unit that's already active - if this Pi
    // already had a beedeployment.service running (e.g. from an earlier
    // manual setup, or a previous slot/port), that old process keeps
    // running with its old ExecStart args (old port) until something
    // actually restarts it. An explicit restart right after covers both
    // "wasn't running yet" (restarting an inactive-then-just-started unit
    // is harmless) and "was already running with stale args" (this is the
    // case that actually needs it) in one step.
    await sshExec(
      resolved,
      keyPath,
      `chmod +x '${remoteDirFor()}/install_beedeployment_service.sh' && ` +
        `cd '${remoteDirFor()}' && sudo ./install_beedeployment_service.sh ${gdsHost} ${resolved.assignedPort} ${resolved.sshUser} && ` +
        `sudo systemctl restart beedeployment.service`,
    );
  });

  const sha = await currentGitSha();
  await prisma.pi.update({
    where: { id: pi.id },
    data: {
      status: "ACTIVE",
      lastDeployedSha: sha,
      lastDeployedAt: new Date(),
    },
  });
  console.log(`[initial-setup] ${pi.name} is now ACTIVE (sha ${sha.slice(0, 8)})`);
}

async function redeployToPi(pi: Pi) {
  const boards = await prisma.board.findMany({ where: { piId: pi.id } });
  await withPiKeyFile(pi, async (keyPath) => {
    await uploadPiFiles(pi, boards, keyPath);
    await sshExec(pi, keyPath, "sudo systemctl restart beedeployment.service");
  });
  const sha = await currentGitSha();
  await prisma.pi.update({
    where: { id: pi.id },
    data: { lastDeployedSha: sha, lastDeployedAt: new Date() },
  });
  console.log(`[redeploy] ${pi.name} redeployed (sha ${sha.slice(0, 8)})`);
}

// How long to hold the Pi in an active bluetoothctl scan for
// SCAN_FOR_BOARDS - matches DISCOVERY_SCAN_SECONDS in
// Components/WiiBoardManager/WiiBoardManager.cpp, the window already
// tuned for this exact board model to reliably show up in a scan after
// its physical sync button is pressed.
const SCAN_DURATION_SECONDS = 20;

// Matches WiiBoardManager.cpp's BOARD_NAME constant - what this board
// model reports as its Bluetooth device name.
const BOARD_PRODUCT_NAME = "Nintendo Wii Remote Balance Board";

async function handleScanForBoards(pi: Pi) {
  const resolved = await resyncIfNeeded(pi);
  const existingBoards = await prisma.board.findMany({ where: { piId: pi.id } });
  const alreadyOnThisPi = new Set(existingBoards.map((b) => b.bluetoothMac));

  const output = await withPiKeyFile(resolved, (keyPath) =>
    sshExec(
      resolved,
      keyPath,
      // One long-lived bluetoothctl process fed a command sequence over
      // stdin, not a one-shot `bluetoothctl scan on` CLI invocation -
      // BlueZ ties an active discovery session to the requesting client's
      // D-Bus connection, so a process that exits immediately after
      // issuing "scan on" stops discovery the instant it exits. Same
      // reasoning as WiiBoardManager.cpp's own popen()-based handling,
      // just shelled out over SSH instead of from the flight binary -
      // this runs independently of whatever beedeployment.service is
      // doing with its own already-configured boards.
      `{ echo "scan on"; sleep ${SCAN_DURATION_SECONDS}; echo "devices"; echo "scan off"; echo "quit"; } | bluetoothctl`,
    ),
  );

  // bluetoothctl's `devices` output lines look like:
  //   Device 00:1F:32:22:03:BF Nintendo Wii Remote Balance Board
  const found = new Set<string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.*)$/);
    if (match && match[2].includes(BOARD_PRODUCT_NAME)) {
      found.add(match[1].toUpperCase());
    }
  }
  // Only genuinely new boards - one already added to this Pi showing up
  // again (it's realistically still nearby) isn't a useful "discovery."
  const newMacs = [...found].filter((mac) => !alreadyOnThisPi.has(mac));

  await prisma.pi.update({
    where: { id: pi.id },
    data: {
      lastScanResults: newMacs.map((mac) => ({
        mac,
        discoveredAt: new Date().toISOString(),
      })),
      lastScanAt: new Date(),
    },
  });
  console.log(
    `[scan] ${pi.name}: found ${newMacs.length} new board(s)` +
      (newMacs.length ? ` - ${newMacs.join(", ")}` : ""),
  );
}

async function handlePendingActions() {
  const pis = await prisma.pi.findMany({ where: { pendingAction: { not: null } } });
  for (const pi of pis) {
    const action = pi.pendingAction;
    try {
      if (action === "RESYNC_IP") {
        await handleResyncIp(pi);
      } else if (action === "INITIAL_SETUP") {
        await handleInitialSetup(pi);
      } else if (action === "REDEPLOY") {
        await redeployToPi(pi);
      } else if (action === "SCAN_FOR_BOARDS") {
        await handleScanForBoards(pi);
      }
      await prisma.pi.update({
        where: { id: pi.id },
        data: { pendingAction: null, lastActionError: null },
      });
    } catch (err) {
      console.error(`[action] ${action} failed for ${pi.name}:`, (err as Error).message);
      await prisma.pi.update({
        where: { id: pi.id },
        data: { pendingAction: null, lastActionError: (err as Error).message },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-redeploy on origin/main movement
// ---------------------------------------------------------------------------

async function rebuildIfOriginMoved(): Promise<boolean> {
  await run("git", ["fetch", "origin", "main"], { cwd: BEEHIVE_PROJECT_DIR });
  const [local, remote] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], { cwd: BEEHIVE_PROJECT_DIR }),
    run("git", ["rev-parse", "origin/main"], { cwd: BEEHIVE_PROJECT_DIR }),
  ]);
  if (local.trim() === remote.trim()) return false;

  console.log(`[build] origin/main moved (${local.trim().slice(0, 8)} -> ${remote.trim().slice(0, 8)}), pulling + rebuilding`);
  await run("git", ["merge", "--ff-only", "origin/main"], { cwd: BEEHIVE_PROJECT_DIR });
  await run(FPRIME_UTIL!, ["build", "aarch64-linux"], { cwd: BEEHIVE_PROJECT_DIR });
  // Also rebuilds the beehive-gds image - a moved origin/main might have
  // changed the Dockerfile or tools/ just as easily as the flight
  // software, and there's no separate trigger for that now that this repo
  // has no docker-compose.yml of its own (see ensureGdsImage() below for
  // why that went away).
  await buildGdsImage();
  console.log("[build] rebuild complete");
  return true;
}

// Builds beehive-gds:latest directly (`docker build`), not via a
// docker-compose.yml in beehive-project - that file used to exist purely
// to build+run one shared gds/decoder pair, which stopped making sense
// once every Pi got its own dedicated pair (see ensureDockerContainers()
// below) instead of sharing one. This is the one remaining place that
// image gets built.
async function buildGdsImage() {
  await run("docker", ["build", "-t", "beehive-gds:latest", "."], { cwd: BEEHIVE_PROJECT_DIR });
}

async function ensureGdsImage() {
  const out = await run("docker", ["images", "-q", "beehive-gds:latest"]);
  if (out.trim() === "") {
    console.log("[build] beehive-gds:latest not found, building it now");
    await buildGdsImage();
  }
}

async function redeployActivePis() {
  const sha = await currentGitSha();
  const activePis = await prisma.pi.findMany({
    where: { status: "ACTIVE", resolvedIp: { not: null }, sshPrivateKeyEncrypted: { not: null } },
  });
  for (const pi of activePis) {
    if (pi.lastDeployedSha === sha) continue;
    try {
      await redeployToPi(pi);
    } catch (err) {
      console.error(`[redeploy] failed for ${pi.name}:`, (err as Error).message);
      await prisma.pi.update({
        where: { id: pi.id },
        data: { lastActionError: (err as Error).message },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Per-Pi GDS/decoder Docker containers - separate container pair per Pi
// (not one shared GDS multiple Pis connect to, not plain background
// processes) - see the "Multi-Pi / multi-board fleet management" plan for
// why. Reuses the beehive-gds:latest image (see buildGdsImage()/
// ensureGdsImage() above) rather than each Pi getting its own image.
// ---------------------------------------------------------------------------

async function containerExists(name: string): Promise<boolean> {
  const out = await run("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]);
  return out.trim() === name;
}

async function ensureDockerContainers(pi: Pi) {
  const gdsName = `beehive-gds-${pi.id}`;
  const decoderName = `beehive-decoder-${pi.id}`;
  const dpcatDir = path.join(BEEHIVE_PROJECT_DIR!, "DpCat", pi.id);
  const logsDir = path.join(BEEHIVE_PROJECT_DIR!, "logs", pi.id);
  await mkdir(dpcatDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  if (!(await containerExists(gdsName))) {
    await run("docker", [
      "run", "-d", "--name", gdsName, "--restart", "unless-stopped",
      "-p", `${pi.assignedPort}:50000`,
      "-p", `${guiPortFor(pi.assignedPort)}:5000`,
      "-v", `${path.join(BEEHIVE_PROJECT_DIR!, "build-artifacts")}:/app/build-artifacts:ro`,
      "-v", `${dpcatDir}:/data`,
      "-v", `${logsDir}:/app/logs`,
      "beehive-gds:latest",
    ]);
    console.log(`[docker] started ${gdsName} on port ${pi.assignedPort}`);
  }

  if (!(await containerExists(decoderName))) {
    await run("docker", [
      "run", "-d", "--name", decoderName, "--restart", "unless-stopped",
      "-e", "PYTHONUNBUFFERED=1",
      "-v", `${path.join(BEEHIVE_PROJECT_DIR!, "tools")}:/app/tools:ro`,
      "-v", `${path.join(BEEHIVE_PROJECT_DIR!, "build-artifacts")}:/app/build-artifacts:ro`,
      "-v", `${dpcatDir}:/app/DpCat`,
      "--entrypoint", "python3",
      "beehive-gds:latest",
      "tools/watch_dpcat_decode.py",
    ]);
    console.log(`[docker] started ${decoderName}`);
  }
}

async function teardownDockerContainers(pi: Pi) {
  for (const name of [`beehive-gds-${pi.id}`, `beehive-decoder-${pi.id}`]) {
    if (await containerExists(name)) {
      await run("docker", ["rm", "-f", name]);
      console.log(`[docker] removed ${name}`);
    }
  }
}

async function reconcileDockerContainers() {
  // Covers the very first run on a fresh host, where origin/main hasn't
  // moved yet (so rebuildIfOriginMoved()'s own build never fires) but the
  // image has never been built at all.
  await ensureGdsImage();
  const allPis = await prisma.pi.findMany();
  for (const pi of allPis) {
    try {
      if (pi.status === "ACTIVE") {
        await ensureDockerContainers(pi);
      } else {
        await teardownDockerContainers(pi);
      }
    } catch (err) {
      console.error(`[docker] reconcile failed for ${pi.name}:`, (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loops
// ---------------------------------------------------------------------------

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fastLoop() {
  while (true) {
    try {
      await ensureKeypairs();
      await handlePendingActions();
    } catch (err) {
      console.error("[fastLoop] unexpected error:", err);
    }
    await sleep(FAST_POLL_MS);
  }
}

async function slowLoop() {
  while (true) {
    try {
      await rebuildIfOriginMoved();
      await redeployActivePis();
      await reconcileDockerContainers();
    } catch (err) {
      console.error("[slowLoop] unexpected error:", err);
    }
    await sleep(SLOW_POLL_MS);
  }
}

console.log(`Deployer starting. beehive-project checkout: ${BEEHIVE_PROJECT_DIR}`);
Promise.all([fastLoop(), slowLoop()]).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
