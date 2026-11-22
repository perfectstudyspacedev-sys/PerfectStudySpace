# Scale tests

`npm run test:scale` builds the self-hosted backend locally in Docker (database, REST,
gateway, edge functions), applies this repo's migrations, deploys this repo's `api`
function, loads **dummy** data and runs every check below. It exits non-zero if anything
fails. Never point it at live data.

```bash
npm run test:scale                      # 1,500 students over 3 branches (about 4 minutes)
npm run test:scale -- --seed large      # 20,000 students over 10 branches, two years
npm run test:scale -- --no-orig         # skip comparisons with the original api
npm run test:lint-paging                # only the paging lint (no Docker)
```

Needs Docker (Docker Desktop on Windows/Mac), Node 20+, bash (Git Bash on Windows). The
stack stays up afterwards on `127.0.0.1:8010` (compose project `psslocal`); remove it with
`cd .scale-test/backend && docker compose down -v`. GitHub Actions runs the small seed on
every pull request (`.github/workflows/scale-test.yml`).

| Step | File | What it proves |
|---|---|---|
| 1 | `lint-paging.mjs` | No read of a growing table without paging, a cap, a one-record filter or a written reason; no growing `.in()` list outside `allRowsIn()` |
| 2 | `setup.sh`, `stack/` | The stack as the server kit builds it (`stack/` is a copy of the kit's `stack-template`; the kit in the AlpenGlow repo is the master copy) |
| 3 | `seed-small.sql`, `seed-large.sql` | Dummy data sized so every growing list passes 1000 rows |
| 4a | `check.mjs` | 28 list figures equal the database (with the original api shown next to them); `create_staff` role rules; branch isolation; longest internal URL; 0 supervisor cancels and restarts |
| 4b | `students-pages.mjs` | Pages of 50 put together equal what the Students page used to compute from the full list, for every sort, filter and Combined Hall choice |
| 4c | `calls.mjs` | Each `batch` part equals its own call; the light pollers give what the hooks need |
| 4d | `duplicates.mjs` | A double-clicked payment is recorded once; simultaneous check-ins give one open session per student and per desk |
| 4e | `login-and-cache.mjs` | Login lockout (5 failures, 15 minutes, per username and per IP); cached reads equal the original api |
| 4f | `money-tx.mjs` | The five money actions in one database transaction each (migration 054) leave the same rows and reply as the original api's step-by-step code (twin students in the same state, amounts to the paisa); a failure half way leaves nothing; payments, top-ups and pass bills at the same moment lose nothing. `TWINS_ONLY=1` with the 054 functions hidden proves the fallback |

## Step 2b proofs (run by hand)

The evidence for the pre-migration hardening (fix/pre-migration). Run them against the
stack `npm run test:scale` leaves up. `a-equality.mjs` and `fd-test.mjs` compare with
a function `apiprev`: the `api` of commit bfe2cb1 (before step 2b), copied into
`.scale-test/backend/volumes/functions/apiprev/` (bfe2cb1 still imports from esm.sh,
so it needs no `_vendor`).

| File | Proves |
|---|---|
| `a-equality.mjs` | Report totals computed in SQL equal the old JavaScript sums to the paisa (revenue, daily/monthly reports, referral stats, transactions, discounts), including the fallback when the SQL functions are missing |
| `b-summary.sql` | The nightly summary plus today live equals summing the rows, for 10 day ranges per branch and all branches (`docker exec -i psslocal-db psql -U postgres -d postgres < tests/scale/b-summary.sql`) |
| `b-corrections.sql` | Backdated payments, edits, branch moves and deletes on already-summed days keep the summary exact (the trigger) |
| `c-equality.mjs` | Server-side student pages equal the old browser filtering and sorting |
| `d-calls.mjs` | Combined actions and light pollers equal the separate calls |
| `e-dupes.mjs` | Idempotency keys, one open session per student and per desk |
| `fd-test.mjs` | Login lockout and the 60 s worker cache give the same answers as before |

The type check uses `typecheck-import-map.json`, which points the two libraries stored in
`supabase/functions/_vendor` at the same versions on esm.sh for their types only:
`deno check --import-map=tests/scale/typecheck-import-map.json supabase/functions/api/index.ts`.
