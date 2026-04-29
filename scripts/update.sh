#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] New commits detected, updating..."
git pull origin main
docker compose up -d --build
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Update complete."
