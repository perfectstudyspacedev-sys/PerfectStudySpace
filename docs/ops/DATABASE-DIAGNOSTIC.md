**Single SQL database diagnostic**

Open [full-system-diagnostic.sql](full-system-diagnostic.sql), copy the complete file into
Supabase project **zripsszkprhtyccukrir → SQL Editor**, select the **postgres** role, and run all
of it. There are no placeholders or credentials to insert. Read the result table or export it as CSV.

The file checks the 77 surviving application tables and their expected column names from
migrations 001–073; RLS and primary-key presence; selected critical unique indexes and triggers;
the seven application/scheduler SQL helper signatures; all 44 feature switches and five controls;
27 schedules; Vault job configuration; three required private storage buckets plus a legacy bucket check; prerequisite counts; and bounded
recent AI, scheduler, HTTP, system-event and model-output evidence.

The script does not change business data, install migrations, change settings, invoke helpers,
run jobs, send messages or make AI/network calls. It creates one transaction-local temporary
report and drops it on commit. Rerunning is safe. Secret values, function bodies, scheduler
commands, HTTP bodies and personal records are omitted from its output.

| Result | Meaning |
|---|---|
| PASS | Only the named catalog/configuration check passed; runtime behavior is unproven. |
| FAIL | A missing/invalid database prerequisite, unexpected access, or a recorded failed run needs inspection. Historical failures may have been corrected since. |
| BLOCKED | The check could not run, commonly because an object/extension is absent or permission is missing. |
| OFF | A feature/schedule is disabled. This may be intentional. Missing feature settings default off. |
| ON_UNVERIFIED | A feature switch is on; dependencies and behavior still need manual tests. |
| WARN | Review the evidence; a zero quota, direct chat mode, different cadence or historical refusal can be intentional. |
| NO_DATA | No matching setup/output/history exists. This can mean no eligible users or expired/unretained history. |
| OBSERVED / PRESENT_UNVERIFIED | A historical outcome or prerequisite exists; it is not proof of present functionality or accuracy. |
| UNVERIFIED | Requires an actual browser/API/provider/integration test. |

An HTTP 200 may contain a skipped result. A successful pg_cron run may only have enqueued an
HTTP request. Neither means an AI answer or business action succeeded. SQL cannot inspect
Edge Function environment secrets or establish the currently deployed api/agent/cron versions.

**Validation and known finding (29 October 2026)**

The script was executed locally in an isolated PostgreSQL runtime (PGlite), first against an
empty database, then an incomplete schema, populated platform-shaped test catalogs, and a
database built by actually applying all 73 project migrations. All 77 table/column manifests
matched the resulting schema. Tests checked overwritten numeric controls, feature/schedule
coverage, helper execute grants, provider trace evidence, missing migration 073, secret omission,
temporary-report cleanup and repeat execution. Supabase platform schemas were simulated;
these tests do not replace a live Supabase run.

The actual migrations revealed **overtime_sessions has no RLS enable statement**. The diagnostic
correctly reports FAIL if RLS remains disabled. All other structural checks passed in the disposable
migrated database; enabling that table's RLS there made its check pass too. This was a local test
only, not a change to the user's Supabase database or a new migration.

The live result can differ if settings, policies or migrations have been changed manually.
The first shared live report showed overtime_sessions already has RLS enabled. It also showed
pg_cron is missing, accounting for all 28 blocked schedule/history checks. Its student-photos
FAIL was too strict: current source only references private id-photos/payment-proofs/task-photos
buckets, while student-photos remains in old setup documentation. The diagnostic now reports
a missing legacy bucket as WARN rather than requiring an unused bucket to be created.
Use [the feature checklist](../PSSAI-FEATURE-TESTING.md) and
[the provider test guide](AI-PROVIDERS.md) to finish runtime verification after inspecting this report.

Confirmed repository: [perfectstudyspacedev-sys/PerfectStudySpace, branch pss-ai/all-phases](https://github.com/perfectstudyspacedev-sys/PerfectStudySpace/tree/pss-ai/all-phases).
Cloudflare Pages project: **perfectstudyspace**.

References: [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Edge Function environment secrets](https://supabase.com/docs/guides/functions/secrets).
