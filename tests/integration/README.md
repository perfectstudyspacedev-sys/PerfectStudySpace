# Integration tests (Appendix A part 2, and Phase 2 on a real database)

`npm run test:integration` runs every `tests/integration/*_test.ts` with Deno: the REAL `api`
function and the real Supabase client against a real Postgres with PostgREST. Without a database
configured, each suite prints `skipped: no database` and passes.

- `appendix_a_test.ts` — B1–B10: desk claims racing, double checkout, overlapping attendance,
  early renewal, refused renewals, cancelling an early renewal, Food Pass shortfall, split
  payments, overstay, and the delete refund.
- `phase2_test.ts` — the portal isolation test (a student token never reads or changes another
  student's data), UPI proof confirm (two at once → one renewal), the approval queue, chat, the
  Send list ranking and the sign-up clean-up.

## With a local Supabase (needs Docker)

```bash
supabase start            # prints the API URL and the service_role key
supabase db reset         # applies supabase/migrations — DESTROYS local data; local only
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service_role key> npm run test:integration
```

## With a bare Postgres + PostgREST (no Docker)

Apply every file in `supabase/migrations/` in order to an empty database that has the Supabase
roles (`anon`, `authenticated`, `service_role` with BYPASSRLS, and an `authenticator` login role
granted the three) and a minimal `storage.buckets` table; grant the `service_role` all privileges
on schema `public`; run PostgREST with a `jwt-secret`; then

```bash
PSS_IT_REST=http://127.0.0.1:3001 PSS_IT_SERVICE_KEY=<JWT {role: service_role} signed with jwt-secret> npm run test:integration
```

The harness serves PostgREST under `/rest/v1` the way Supabase does. Each run uses its own
branches, staff and phone numbers, so runs can repeat on the same database. Never point these
tests at the live project: they write rows.
