**Live diagnostic interpretation — 29 October 2026**

Source: the user-supplied result of full-system-diagnostic.sql for confirmed Supabase project
zripsszkprhtyccukrir. This is user-run evidence, not a direct authenticated database session.

The submitted summary was FAIL=2, BLOCKED=28, WARN=0, OFF=5, ON_UNVERIFIED=39, PASS=110.
All 77 expected tables/columns, RLS/primary-key presence, selected indexes/triggers and seven
SQL helper signatures passed. Privileged helper execution was unavailable to browser roles.
In particular, overtime_sessions has RLS enabled in this database, despite the omission in
the original migration. No additional RLS repair is indicated by the submitted result.

| Finding | Interpretation and next action |
|---|---|
| pg_cron absent | Confirmed setup failure. All 27 schedule checks and scheduler-history inspection were blocked by this one missing extension. |
| student-photos absent | Diagnostic overstatement corrected: this bucket occurs in legacy setup notes, not current runtime upload code. It is now a WARN; do not create an unused public identity-photo bucket to clear the report. Current private id-photos/payment-proofs/task-photos checks passed. Check historical integrations separately if used. |
| 39 features on | Switch configuration only, not evidence that dependencies, models, permissions, business rules or browser flows work. |
| Five features off | pssai_auto_approve, pssai_cron, pssai_proof_reading, pssai_retire_staff_ops and pssai_upi_pay were missing/default-off. Enable deliberately after the relevant manual tests and operational gates. |
| Shadow and controls | Shadow on; AI application budget 10 USD; public daily quota 40; enquiry quota 150; confirmation threshold 1000 INR. These reported control values passed. |
| Vault | Exactly one non-placeholder cron secret and the expected project URL passed. This does not verify equality with Edge CRON_SECRET. No secret was supplied in the report. |
| AI | No agent_runs or provider attempts were recorded. Current key presence/access, deployed provider adapter, actual inference, fallback, cost accounting and accuracy remain unverified. |
| Student PIN setup | Zero student_credentials rows; create portal setup codes for test students, set PINs and test isolation/login/logout. |
| Self check-in | Zero branches had the complete location/key setup; configure branches and test QR/location consent using a test student. |
| Models and focus | No student_scores, fingerprints, forecasts, owner_briefs or focus_ratings output was recorded. Run the corresponding data/ML/AI workflows with qualifying history. |
| HTTP | One HTTP 200 response was observed. The diagnostic intentionally omits its body; it can belong to another request or report skipped work, so it does not establish AI success. |
| Other deployment behavior | Frontend build, routing, CORS, Edge versions, credentials, signed URLs, concurrency and long-running pilots remain outside the SQL report's proof. |

**Immediate database preparation**

Run [prepare-missing-schedules.sql](prepare-missing-schedules.sql) as postgres in this project's
SQL Editor. It installs pg_cron using Supabase's documented schema/grants, verifies the existing
Vault target/secret and helper prerequisites, and creates the 27 missing schedules **paused**.
It preserves existing jobs and settings and makes no HTTP/model/business-action calls.
No placeholders or credentials need to be pasted into the script.

Then rerun [full-system-diagnostic.sql](full-system-diagnostic.sql). Expect pg_cron to pass,
schedules to show OFF for newly prepared jobs, and an empty scheduler history until jobs are
tested/activated. This deliberately resolves installation, not live execution.

Before activating a schedule, deploy/verify matching functions and Edge CRON_SECRET, then
test its business flow and activate only the intended job. Keep chat shadow review on during
evaluation. Do not enable retirement, public onboarding/payment readers or all schedules merely
to remove OFF results.

Use the [AI provider guide](AI-PROVIDERS.md) for the first owner Analyst request and the
[feature checklist](../PSSAI-FEATURE-TESTING.md) for the remaining workflows.

The revised diagnostic passed isolated empty/incomplete/populated-schema tests and actual
001–073 migration execution. Schedule setup logic passed contract tests with simulated cron
APIs for exact job/cadence/helper mapping, new-job pausing, rerun preservation, wrong-project
rejection and duplicate detection. The real Supabase pg_cron engine was not executed locally.

References: [Supabase Cron installation](https://supabase.com/docs/guides/cron/install),
[activation/deactivation](https://supabase.com/docs/guides/cron/quickstart).
