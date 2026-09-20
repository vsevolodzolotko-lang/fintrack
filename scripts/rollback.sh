#!/usr/bin/env bash
# Roll back FinTrack: check out a prior ref and rebuild; optionally restore the DB.
#
# Usage:
#   FINTRACK_SSH=user@your-box scripts/rollback.sh <git-ref> [backup-filename]
#
# Examples:
#   scripts/rollback.sh HEAD~1
#   scripts/rollback.sh fcc63b1 fintrack-20260711T155000Z.sql
set -euo pipefail

REMOTE="${FINTRACK_SSH:?set FINTRACK_SSH=user@host}"
TARGET="${1:?usage: rollback.sh <git-ref> [backup-filename]}"
BACKUP="${2:-}"

ssh "$REMOTE" "TARGET='$TARGET' BACKUP='$BACKUP' bash -s" <<'REMOTE_EOF'
set -euo pipefail
APP_DIR="${FINTRACK_DIR:-/opt/fintrack}"
cd "$APP_DIR"
set -a; . ./.env; set +a

echo "==> Fetch + checkout $TARGET"
git fetch origin
git checkout "$TARGET"
docker compose up -d --build

if [ -n "$BACKUP" ]; then
  echo "==> Restore DB from backups/$BACKUP"
  test -f "backups/$BACKUP" || { echo "ERROR: backups/$BACKUP not found" >&2; exit 1; }
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "backups/$BACKUP"
fi

echo "==> Health check ($PUBLIC_BASE_URL)"
code=""
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_BASE_URL}/" || true)
  [ "$code" = "200" ] && break
  sleep 3
done
docker compose ps
[ "$code" = "200" ] && echo "ROLLBACK OK ($code)" || { echo "ROLLBACK health FAILED ($code)" >&2; exit 1; }
REMOTE_EOF
echo "Rollback complete."
