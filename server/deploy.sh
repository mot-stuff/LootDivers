#!/usr/bin/env bash
# Pull-and-restart deploy (TASK-707, DEC-032). Run on the droplet as the
# `deploy` user — normally by GitHub Actions over SSH after green main
# gates, but safe to run by hand as a fallback.
#
# Layout (runbook Part B): repo checkout at /opt/lootdivers/app, env file at
# /opt/lootdivers/.env, compose stack in the checkout's server/ directory.

set -euo pipefail

APP_DIR="/opt/lootdivers/app"
ENV_FILE="/opt/lootdivers/.env"
REPO_URL="https://github.com/mot-stuff/LootDivers.git"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} missing — create it first (runbook Part B step 12)." >&2
  exit 1
fi

if [ ! -d "${APP_DIR}/.git" ]; then
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
git fetch origin main
git reset --hard origin/main

cd server
docker compose --env-file "${ENV_FILE}" up -d --build
docker compose --env-file "${ENV_FILE}" ps

# In-network health check: the API port is not published to the host, so
# probe from inside the api container (node is always present there).
for attempt in $(seq 1 20); do
  if docker compose --env-file "${ENV_FILE}" exec -T api \
    node -e "fetch('http://127.0.0.1:3000/healthz').then((r)=>{if(!r.ok)throw new Error(String(r.status));return r.text()}).then((t)=>{console.log(t)}).catch(()=>{process.exit(1)})"; then
    echo "deploy healthy after ${attempt} attempt(s)"
    exit 0
  fi
  sleep 3
done

echo "ERROR: API failed the health check after deploy; recent logs:" >&2
docker compose --env-file "${ENV_FILE}" logs --tail=100 api >&2
exit 1
