#!/usr/bin/env bash
# Run inside the LXC container to harden auto-start after host reboot.
# Idempotent — safe to re-run at any time.
set -euo pipefail

echo "=== offer-radar autostart check ==="

# 1. Docker service enabled at boot
if ! systemctl is-enabled --quiet docker 2>/dev/null; then
  systemctl enable docker
  echo "✅ docker.service enabled"
else
  echo "✓  docker.service already enabled"
fi

# 2. Sanity-check container restart policy
RESTART=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' offer-radar 2>/dev/null || echo "not-running")
if [[ "$RESTART" == "unless-stopped" || "$RESTART" == "always" ]]; then
  echo "✓  container restart policy = $RESTART"
elif [[ "$RESTART" == "not-running" ]]; then
  echo "⚠️  container 'offer-radar' not found — run: cd /opt/offer-radar && docker compose up -d"
else
  echo "⚠️  container restart policy is '$RESTART' — expected 'unless-stopped'"
  echo "    Fix: cd /opt/offer-radar && docker compose up -d"
fi

# 3. Remind user about the one step that must be done on the Proxmox host
cat <<'EOF'

────────────────────────────────────────────────────────
ONE MANUAL STEP — run on the Proxmox HOST (not in this LXC):

  pct set <CTID> --onboot 1

Find your CTID with:  pct list

This tells Proxmox to start the LXC automatically when the host boots.
────────────────────────────────────────────────────────
EOF
