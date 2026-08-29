#!/usr/bin/env bash
# Installs a per-user systemd service that runs scripts/deployer.ts
# (the fleet deployer - see README.md's fleet management section)
# continuously in the background.
#
# Run this ON THE SAME HOST that already runs the rest of the stack
# (devin-server, in this project's case) - the deployer needs `ssh-keygen`,
# `tailscale`, `docker`, `git`, and beehive-project's `fprime-util` all on
# this machine's PATH/filesystem, plus a Postgres it can reach (see
# .env's DATABASE_URL / docker-compose.yml's `db` service comment).
#
# Usage: ./install_deployer_service.sh [beehive-project-dir]
#   beehive-project-dir defaults to ../beehive-project (sibling checkout,
#   matching the convention docker-compose.yml's `include:` already uses).
#   This becomes BEEHIVE_PROJECT_DIR - a checkout DEDICATED to the
#   deployer, since it runs `git fetch`/`git merge --ff-only origin/main`
#   and `fprime-util build aarch64-linux` against it on its own schedule
#   (see scripts/deployer.ts's top comment) - if you point this at a
#   checkout you also poke at by hand, expect the deployer to fast-forward
#   it out from under you.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
beehive_project_dir="${1:-$(cd "$repo_root/../beehive-project" && pwd)}"

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/beehive-deployer.service"
node_bin="$(command -v node)"
tsx_bin="$repo_root/node_modules/.bin/tsx"

if [[ ! -e "$beehive_project_dir/.git" ]]; then
    echo "Not a git checkout: $beehive_project_dir" >&2
    echo "Clone beehive-project there first, or pass its path as \$1." >&2
    exit 1
fi

if [[ ! -x "$tsx_bin" ]]; then
    echo "Missing $tsx_bin - run 'pnpm install' in $repo_root first." >&2
    exit 1
fi

if [[ ! -f "$repo_root/.env" ]]; then
    echo "Missing $repo_root/.env - copy .env.example to .env and fill it" >&2
    echo "in first (needs at least DATABASE_URL and SSH_KEY_ENCRYPTION_SECRET)." >&2
    exit 1
fi

mkdir -p "$unit_dir"

cat >"$unit_file" <<EOF
[Unit]
Description=Beehive fleet deployer
After=network-online.target docker.service tailscaled.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo_root
Environment=BEEHIVE_PROJECT_DIR=$beehive_project_dir
ExecStart=$node_bin $tsx_bin $repo_root/scripts/deployer.ts
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now beehive-deployer.service

echo "Installed and started: $unit_file"
echo "Using beehive-project checkout: $beehive_project_dir"
echo "Watch it with: journalctl --user -u beehive-deployer -f"
echo "To keep it running after logout, enable lingering: loginctl enable-linger \"$USER\""
