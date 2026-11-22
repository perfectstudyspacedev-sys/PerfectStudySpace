#!/usr/bin/env bash
# PSS backend deploy to the shared server (deploy/vps-deploy.sh). The master copy
# is deploy/server-migration/pss/vps-deploy.sh in the AlpenGlow migration kit.
# Same pattern as AlpenGlow's deploy/vps-deploy.sh, but it only ever touches
# the PSS stack (~/projects/pss, container pss-db, compose project "pss").
#
# Run from the PSS repo root after ANY change to supabase/functions/* or
# supabase/migrations/*.sql:
#   VPS_HOST=deploy@NEW_SERVER_IP bash deploy/vps-deploy.sh
#
# What it does:
#   1. Mirrors supabase/functions/ to the server (reference copy in
#      ~/projects/pss/repo, live copy in ~/projects/pss/backend/volumes/functions).
#      The stack's own "main" router there is never touched.
#   2. Applies only the migrations not yet recorded in public._migrations_applied,
#      each in its own transaction. Before the FIRST run, that table must list
#      001 to 051: the live data arrives as a dump, and 002, 010 and 016 cannot
#      be replayed on this stack anyway (they touch Supabase Storage, which the
#      slim stack does not run). See PSS-MIGRATION-PLAN.md, Phase 2.
#      That table is created with row security on and no access for the
#      public key (AlpenGlow's copy was readable and writable by anyone).
#   3. Restarts the PSS functions container.
# Step 0 checks the server first and stops, with nothing changed, if the stack,
# its router, the recorded migrations or the function secrets are not in place.
set -euo pipefail

VPS_HOST="${VPS_HOST:-}"
[ -n "$VPS_HOST" ] || { echo "Set VPS_HOST, e.g. VPS_HOST=deploy@203.0.113.10 bash deploy/vps-deploy.sh"; exit 1; }
REMOTE_REPO_DIR="projects/pss/repo"
REMOTE_BACKEND_DIR="projects/pss/backend"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Migrations that arrived with the live data (the dump) and must already be recorded
# in _migrations_applied: every repo file up to and including this number.
BASELINE_MAX=051

echo "==> [0/3] Checking the server before changing anything..."
# Stops here, with nothing changed, unless: the PSS stack exists and runs, its "main"
# router is in place, _migrations_applied lists every baseline migration (an empty or
# missing table would make step 2 replay 001 onwards over the live data), and the
# function secrets are filled in. Values are never printed, only whether they are set.
baseline=""
for f in "$LOCAL_ROOT"/supabase/migrations/*.sql; do
  n=$(basename "$f"); num="${n%%_*}"
  [[ "$num" =~ ^[0-9]+$ ]] && [ "$((10#$num))" -le "$((10#$BASELINE_MAX))" ] && baseline+="$n "
done
ssh "$VPS_HOST" "BASELINE='$baseline' bash -s" <<'PRECHECK'
set -uo pipefail
bad=0
fail() { echo "  ! $1"; bad=1; }
cd ~/projects/pss/backend 2>/dev/null || { echo "  ! ~/projects/pss/backend does not exist: the PSS stack is not set up on this server"; exit 1; }
for c in pss-db pss-rest pss-kong pss-functions; do
  st=$(docker inspect -f '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
  case "$st" in running|running/healthy) ;; *) fail "container $c is $st" ;; esac
done
[ -f volumes/functions/main/index.ts ] || fail "the stack's main router (volumes/functions/main/index.ts) is missing"
for k in STAFF_JWT_SECRET PUBLIC_SITE_KEY; do
  grep -qE "^$k=.+" functions.env 2>/dev/null || fail "$k is not set in functions.env"
done
recorded=$(docker exec pss-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" 2>/dev/null) \
  || { fail "public._migrations_applied cannot be read (missing table, or the database is down)"; recorded=""; }
missing=0
for f in $BASELINE; do printf '%s\n' "$recorded" | grep -qxF "$f" || missing=$((missing + 1)); done
[ "$missing" = 0 ] || fail "$missing of the baseline migrations are not recorded in _migrations_applied (PSS plan, Phase 2 step 5)"
[ "$bad" = 0 ] || { echo "  Nothing was changed."; exit 1; }
echo "  stack running, router present, secrets set, $(printf '%s\n' "$recorded" | grep -c .) migrations recorded"
PRECHECK

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

$DB psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "
  CREATE TABLE IF NOT EXISTS public._migrations_applied (
    filename text PRIMARY KEY,
    applied_at timestamptz DEFAULT now()
  );
  ALTER TABLE public._migrations_applied ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public._migrations_applied FROM anon, authenticated;
" > /dev/null

any_new=0
for f in *.sql; do
  case "$f" in *[!A-Za-z0-9._-]*) echo "  ! skipping oddly named file: $f"; continue ;; esac
  already=$($DB psql -U postgres -d postgres -tAc "SELECT 1 FROM public._migrations_applied WHERE filename='$f'")
  [ "$already" = "1" ] && continue
  any_new=1
  echo "  - applying $f"
  # One transaction per file: a failing migration leaves nothing half applied.
  docker exec -i pss-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < "$f"
  $DB psql -U postgres -d postgres -q -c "INSERT INTO public._migrations_applied (filename) VALUES ('$f')" > /dev/null
done
[ "$any_new" = 1 ] || echo "  (no new migrations — everything already applied)"
REMOTE_SCRIPT

echo "==> [3/3] Restarting the PSS functions container..."
ssh "$VPS_HOST" "cd ~/$REMOTE_BACKEND_DIR && docker compose restart functions"

echo "==> Done. Tail logs with:"
echo "    ssh $VPS_HOST 'cd ~/$REMOTE_BACKEND_DIR && docker compose logs -f functions'"
