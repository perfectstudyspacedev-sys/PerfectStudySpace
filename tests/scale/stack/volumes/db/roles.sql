-- Gives the stack's login roles the stack's own password. Adapted from
-- Supabase's docker/volumes/db/roles.sql: the slim stack leaves out the
-- webhooks init script that creates supabase_functions_admin, so only roles
-- that actually exist are changed (the upstream file stops with an error on
-- the missing one and leaves the database half initialised).
\set pgpass `echo "$POSTGRES_PASSWORD"`

SELECT format('ALTER ROLE %I WITH PASSWORD %L', rolname, :'pgpass')
  FROM pg_roles
 WHERE rolname IN ('authenticator', 'pgbouncer', 'supabase_auth_admin',
                   'supabase_functions_admin', 'supabase_storage_admin')
\gexec
