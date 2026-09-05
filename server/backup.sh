#!/usr/bin/env bash
# Daily Postgres backup (TASK-707; runbook Part B step 14 schedules this via
# the deploy user's crontab). Dumps the running container's database into
# /opt/lootdivers/backups with a timestamp and 14-day retention.
#
# Restore drill (documented per TASK-707 acceptance criterion 7 — run it once
# after the first backup, and after any Postgres major upgrade):
#
#   cd /opt/lootdivers/app/server
#   docker compose --env-file /opt/lootdivers/.env exec -T postgres \
#     createdb -U lootdivers restore_drill
#   docker compose --env-file /opt/lootdivers/.env exec -T postgres \
#     pg_restore -U lootdivers -d restore_drill --no-owner \
#     < /opt/lootdivers/backups/<latest>.dump
#   docker compose --env-file /opt/lootdivers/.env exec -T postgres \
#     psql -U lootdivers -d restore_drill -c "select count(*) from characters"
#   docker compose --env-file /opt/lootdivers/.env exec -T postgres \
#     dropdb -U lootdivers restore_drill

set -euo pipefail

BACKUP_DIR="/opt/lootdivers/backups"
ENV_FILE="/opt/lootdivers/.env"
COMPOSE_DIR="/opt/lootdivers/app/server"
STAMP="$(date +%Y%m%d-%H%M%S)"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"
cd "${COMPOSE_DIR}"

docker compose --env-file "${ENV_FILE}" exec -T postgres \
  pg_dump -U lootdivers -d lootdivers --format=custom \
  > "${BACKUP_DIR}/lootdivers-${STAMP}.dump"

find "${BACKUP_DIR}" -name 'lootdivers-*.dump' -mtime +"${RETENTION_DAYS}" -delete

echo "backup written: ${BACKUP_DIR}/lootdivers-${STAMP}.dump"
