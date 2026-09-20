#!/usr/bin/env bash
# Deploy FinTrack to the production box over SSH.
# Flow: push main -> server pg_dump backup (keep 10) -> git pull -> rebuild -> health-check.
#
# Usage:
#   FINTRACK_SSH=user@your-box scripts/deploy.sh
set -euo pipefail

REMOTE="${FINTRACK_SSH:?set FINTRACK_SSH=user@host}"
BRANCH="main"

# 1) Local preflight: clean working tree, then push main.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: uncommitted changes in working tree. Commit before deploying." >&2
  exit 1
fi
echo "==> Pushing $BRANCH to origin"
git push origin "$BRANCH"

# 2) Remote: backup -> prune -> pull -> rebuild -> health-check.
ssh "$REMOTE" 'bash -s' <<'REMOTE_EOF'
set -euo pipefail
APP_DIR="${FINTRACK_DIR:-/opt/fintrack}"
BRANCH=main
KEEP=10
cd "$APP_DIR"
set -a; . ./.env; set +a

mkdir -p backups
ts=$(date -u +%Y%m%dT%H%M%SZ)
echo "==> Backup -> backups/fintrack-$ts.sql"
# </dev/null: this script is fed to `bash -s` over ssh stdin; `docker compose
# exec -T` also reads stdin and would otherwise swallow the rest of the script.
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists </dev/null > "backups/fintrack-$ts.sql"
# Keep only the newest $KEEP dumps.
ls -1t backups/fintrack-*.sql 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f

echo "==> Pull $BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Rebuild"
docker compose up -d --build

echo "==> Health check ($PUBLIC_BASE_URL)"
web=""; apic=""
for i in $(seq 1 15); do
  web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_BASE_URL}/" || true)
  # Backend liveness: the API is auth-guarded, so a healthy server answers 401
  # here. A crash-looped server — e.g. `prisma db push` refusing a destructive
  # schema change (we run it WITHOUT --accept-data-loss on purpose) — returns
  # 502/000. The old "/"-only check missed this: caddy/web stays 200 while the
  # server is down, so a broken deploy reported "HEALTH OK".
  apic=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_BASE_URL}/api/dashboard" || true)
  [ "$web" = "200" ] && [ "$apic" = "401" ] && break
  sleep 3
done
docker compose ps
if [ "$web" = "200" ] && [ "$apic" = "401" ]; then
  echo "HEALTH OK (web / -> 200, backend /api/dashboard -> 401)"
else
  echo "HEALTH FAILED (web=$web api=$apic; backend down if api is 502/000 -- often a refused prisma db push) -- consider scripts/rollback.sh" >&2
  docker compose logs --tail=40 server >&2
  exit 1
fi
REMOTE_EOF
echo "Deploy complete."
