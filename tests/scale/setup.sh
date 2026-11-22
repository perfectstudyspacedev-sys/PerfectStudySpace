#!/usr/bin/env bash
# Test stack for npm run test:scale (laptop or CI): the self-hosted stack from
# tests/scale/stack (a copy of the server kit's stack-template; the kit in the
# AlpenGlow repo, deploy/server-migration/new-server, is the master copy), with
# throw-away secrets and DUMMY data only. Never load live data into it.
#
#   bash tests/scale/setup.sh <work-dir> [orig-ref]
#   bash tests/scale/setup.sh .scale-test origin/main
#
# What it builds, in <work-dir>/backend (compose project "psslocal"):
#   - the 4 stack containers, gateway on 127.0.0.1:8010
#   - function "api" from this repo's working tree (with supabase/functions/_vendor),
#     and, if [orig-ref] is given, function "apiorig" from that ref for side-by-side runs
#   - migrations 001 onwards, recorded in _migrations_applied. Migrations 002, 010
#     and 016 also touch Supabase Storage; a stub storage schema is created first so
#     they apply in full (the server never gets this stub: its schema comes from the
#     live dump)
# Then load seed.sql (dummy data) and run check.mjs.
#
# Remove everything again:  cd <work-dir>/backend && docker compose down -v
set -euo pipefail

WORK="${1:?work dir}"
ORIG_REF="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PSS="$(cd "$HERE/../.." && pwd)"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
DIR="$WORK/backend"
NAME=psslocal
step() { echo; echo "==> $1"; }

if [ -d "$DIR" ]; then
  [ -f "$DIR/.local-test" ] || { echo "$DIR exists and was not made by this script; not touching it."; exit 1; }
  step "removing the previous local stack"
  (cd "$DIR" && docker compose down -v --remove-orphans) || true
  rm -rf "$DIR"
fi
mkdir -p "$WORK"

step "stack folder from the kit's stack-template"
cp -r "$HERE/stack" "$DIR"
rm -f "$DIR/.env.example"
touch "$DIR/.local-test"
sed -i "s/__PROJECT__/$NAME/g" "$DIR/docker-compose.yml"

step "throw-away secrets (local only)"
JWT_SECRET="$(openssl rand -hex 32)"
read -r ANON_KEY SERVICE_ROLE_KEY < <(JWT_SECRET="$JWT_SECRET" node -e '
const c = require("crypto"); const s = process.env.JWT_SECRET;
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (role) => { const now = Math.floor(Date.now() / 1000);
  const h = b({ alg: "HS256", typ: "JWT" }), p = b({ role, iss: "supabase", iat: now, exp: now + 10 * 365 * 86400 });
  return `${h}.${p}.${c.createHmac("sha256", s).update(`${h}.${p}`).digest("base64url")}`; };
console.log(sign("anon"), sign("service_role"));')
# Same keys and defaults add-project.sh writes on the server.
cat > "$DIR/.env" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
JWT_EXPIRY=3600
KONG_HTTP_PORT=8010
SUPABASE_PUBLIC_URL=http://127.0.0.1:8010
DB_MEM_LIMIT=1280m
DB_SHARED_BUFFERS=384MB
DB_EFFECTIVE_CACHE_SIZE=1GB
REST_MEM_LIMIT=512m
PGRST_DB_POOL=20
KONG_MEM_LIMIT=768m
FUNCTIONS_MEM_LIMIT=2048m
FUNCTIONS_CPUS=3
EDGE_WORKER_MEMORY_MB=512
EDGE_WORKER_TIMEOUT_MS=150000
EDGE_WORKER_CPU_SOFT_MS=15000
EDGE_WORKER_CPU_HARD_MS=45000
EDGE_MAX_PARALLELISM=8
EDGE_REQUEST_WAIT_TIMEOUT_MS=30000
NGINX_RATE=40r/s
NGINX_BURST=120
EOF
cat > "$DIR/functions.env" <<EOF
STAFF_JWT_SECRET=$(openssl rand -hex 32)
PUBLIC_SITE_KEY=local-test-site-key
EOF

# Laptop only: Postgres cannot keep its data folder on a Windows bind mount, so the
# database lives in a Docker volume here. On the server it stays ./volumes/db/data.
cat > "$DIR/docker-compose.override.yml" <<'EOF'
services:
  db:
    volumes: !override
      - ./volumes/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:Z
      - ./volumes/db/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:Z
      - db-data:/var/lib/postgresql/data
      - db-config:/etc/postgresql-custom
volumes:
  db-data:
EOF

step "functions: api (working tree)${ORIG_REF:+ and apiorig ($ORIG_REF)}"
mkdir -p "$DIR/volumes/functions/api"
cp "$PSS/supabase/functions/api/index.ts" "$DIR/volumes/functions/api/index.ts"
[ -d "$PSS/supabase/functions/_vendor" ] && cp -r "$PSS/supabase/functions/_vendor" "$DIR/volumes/functions/_vendor"
if [ -n "$ORIG_REF" ]; then
  mkdir -p "$DIR/volumes/functions/apiorig"
  git -C "$PSS" show "$ORIG_REF:supabase/functions/api/index.ts" > "$DIR/volumes/functions/apiorig/index.ts"
fi

step "start the stack"
(cd "$DIR" && docker compose up -d)
for _ in $(seq 1 60); do
  unhealthy=$(cd "$DIR" && docker compose ps --format '{{.Name}} {{.Health}}' | awk '$2 != "healthy"' || true)
  [ -z "$unhealthy" ] && break
  sleep 5
done
(cd "$DIR" && docker compose ps)
[ -z "$unhealthy" ] || { echo "Not healthy after 5 minutes: $unhealthy"; exit 1; }

step "migrations (stub storage schema first)"
psql_db() { docker exec -i "$NAME-db" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# The image ships an empty storage schema owned by a Supabase role, and postgres is not
# a superuser here: the stub is made by supabase_admin and handed to postgres, which
# runs the migrations (creating a policy needs the table's owner).
docker exec -i "$NAME-db" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE, CREATE ON SCHEMA storage TO postgres;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean);
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets OWNER TO postgres;
ALTER TABLE storage.objects OWNER TO postgres;
SQL
psql_db <<'SQL'
CREATE TABLE IF NOT EXISTS public._migrations_applied (filename text PRIMARY KEY, applied_at timestamptz DEFAULT now());
ALTER TABLE public._migrations_applied ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._migrations_applied FROM anon, authenticated;
SQL
n=0
for f in "$PSS"/supabase/migrations/*.sql; do
  base=$(basename "$f")
  psql_db --single-transaction < "$f" > /dev/null
  psql_db -c "INSERT INTO public._migrations_applied (filename) VALUES ('$base')" > /dev/null
  n=$((n + 1))
done
echo "    $n migrations applied and recorded"
(cd "$DIR" && docker compose restart rest functions > /dev/null)

step "done"
echo "    Gateway: http://127.0.0.1:8010/functions/v1/api (fixed) and /apiorig (original)"
echo "    Next: docker exec -i $NAME-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < $HERE/seed-small.sql"
