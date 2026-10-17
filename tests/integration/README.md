# Integration tests (Appendix A, part 2)

Run with `npm run test:integration` against a local Supabase (`supabase start`, needs Docker).
Cases B1–B10 are required before Phase 2 ships, not in Phase 0. Until then this folder has no
tests and the command passes with nothing to run.

For a database-free check of the same server code, `npm run test:server` runs the real `api`
function against an in-memory stand-in for Supabase (see `tests/server/`).
