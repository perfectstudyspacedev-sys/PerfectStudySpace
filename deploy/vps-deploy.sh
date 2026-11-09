#!/usr/bin/env bash
# PSS all-phases backend deploy to the self-hosted "pss" stack (made by
# add-project-full.sh in the AlpenGlow repo, deploy/server-migration/pss-all-phases/).
# Based on that repo's deploy/server-migration/pss/vps-deploy.sh. It only ever
# touches the PSS stack (~/projects/pss, containers pss-db and pss-functions,
# compose project "pss"); it never talks to Supabase cloud.
#
# Run from the PSS repo root after ANY change to supabase/functions/* or
# supabase/migrations/*.sql:
#   VPS_HOST=deploy@169.58.43.191 bash deploy/vps-deploy.sh
#
# What it does:
#   0. Checks the stack exists and that public._migrations_applied already
#      lists the migrations (001 to 073 are recorded by hand right after the
#      data restore; the data arrives as a dump, so replaying them would be
#      wrong). If the table is missing or empty it stops before changing
#      anything.
#   1. Mirrors supabase/functions/ (api, cron, agent and _shared) to the server
#      (reference copy in ~/projects/pss/repo, live copy in
#      ~/projects/pss/backend/volumes/functions). The stack's own "main"
#      router there is never touched.
#   2. Applies only the migrations not yet recorded in public._migrations_applied,
#      each in its own transaction, and records each one.
#   3. Restarts the PSS functions container.
set -euo pipefail

VPS_HOST="${VPS_HOST:-}"
[ -n "$VPS_HOST" ] || { echo "Set VPS_HOST, e.g. VPS_HOST=deploy@169.58.43.191 bash deploy/vps-deploy.sh"; exit 1; }
REMOTE_REPO_DIR="projects/pss/repo"
REMOTE_BACKEND_DIR="projects/pss/backend"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for d in api cron agent _shared; do
  [ -d "$LOCAL_ROOT/supabase/functions/$d" ] || { echo "supabase/functions/$d is missing; run this from the PSS repo."; exit 1; }
done

echo "==> [0/3] Checking the pss stack and the migration record..."
ssh "$VPS_HOST" bash -s <<'PREFLIGHT'
set -euo pipefail
for c in pss-db pss-functions; do
  docker inspect "$c" >/dev/null 2>&1 || { echo "  ! container $c not found: is the pss stack running?"; exit 1; }
done
[ -d ~/projects/pss/backend/volumes/functions/main ] || { echo "  ! ~/projects/pss/backend/volumes/functions/main not found"; exit 1; }
n=$(docker exec pss-db psql -U postgres -d postgres -tAc "SELECT CASE WHEN to_regclass('public._migrations_applied') IS NULL THEN -1 ELSE (SELECT count(*) FROM public._migrations_applied) END")
if [ "$n" -le 0 ]; then
  echo "  ! public._migrations_applied is missing or empty. Record 001 to 073 first"
  echo "    (PLAN.md step 10, after the data restore). Nothing was changed."
  exit 1
fi
echo "  ok: stack present, $n migrations recorded"
PREFLIGHT

echo "==> [1/3] Syncing edge functions..."
# rsync isn't available on Windows/Git Bash, so mirror via tar over ssh.
tar czf - -C "$LOCAL_ROOT/supabase/functions" . | \
  ssh "$VPS_HOST" "rm -rf $REMOTE_REPO_DIR/functions && mkdir -p $REMOTE_REPO_DIR/functions && tar xzf - -C $REMOTE_REPO_DIR/functions"
ssh "$VPS_HOST" '
  set -e
  for d in '"$REMOTE_REPO_DIR"'/functions/*/; do
    name=$(basename "$d")
    [ "$name" = main ] && { echo "  ! skipping a repo folder named main (reserved for the router)"; continue; }
    rm -rf "'"$REMOTE_BACKEND_DIR"'/volumes/functions/$name"
    cp -r "$d" "'"$REMOTE_BACKEND_DIR"'/volumes/functions/$name"
    echo "  - $name"
  done
  for d in '"$REMOTE_BACKEND_DIR"'/volumes/functions/*/; do
    name=$(basename "$d")
    if [ "$name" != "main" ] && [ ! -d "'"$REMOTE_REPO_DIR"'/functions/$name" ]; then
      echo "  - removing stale function: $name"
      rm -rf "$d"
    fi
  done
'

echo "==> [2/3] Syncing + applying any new migrations..."
tar czf - -C "$LOCAL_ROOT/supabase/migrations" . | \
  ssh "$VPS_HOST" "mkdir -p $REMOTE_REPO_DIR/migrations && tar xzf - -C $REMOTE_REPO_DIR/migrations"

ssh "$VPS_HOST" bash -s <<'REMOTE_SCRIPT'
set -euo pipefail
cd ~/projects/pss/repo/migrations
DB="docker exec pss-db"

# Kept locked on every run: row security on, no access for the public roles.
$DB psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "
  ALTER TABLE public._migrations_applied ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public._migrations_applied FROM PUBLIC, anon, authenticated;
" > /dev/null

any_new=0
for f in *.sql; do
  case "$f" in *[!A-Za-z0-9._-]*) echo "  ! skipping oddly named file: $f"; continue ;; esac
  already=$($DB psql -U postgres -d postgres -tAc "SELECT 1 FROM public._migrations_applied WHERE filename='$f'")
  [ "$already" = "1" ] && continue
  any_new=1
  echo "  - applying $f"
  # One transaction per file: a failing migration leaves nothing half applied.
  # stdin comes from the file itself, so it cannot swallow this script.
  docker exec -i pss-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < "$f"
  $DB psql -U postgres -d postgres -q -c "INSERT INTO public._migrations_applied (filename) VALUES ('$f')" > /dev/null
done
[ "$any_new" = 1 ] || echo "  (no new migrations — everything already applied)"
REMOTE_SCRIPT

echo "==> [3/3] Restarting the PSS functions container..."
ssh "$VPS_HOST" "cd ~/$REMOTE_BACKEND_DIR && docker compose restart functions"

echo "==> Done. Tail logs with:"
echo "    ssh $VPS_HOST 'cd ~/$REMOTE_BACKEND_DIR && docker compose logs -f functions'"
