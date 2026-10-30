**Manual deployment and live verification — 30 October 2026**

Source: perfectstudyspacedev-sys/PerfectStudySpace, branch **pss-ai/all-phases**.
Supabase project: **zripsszkprhtyccukrir**. Cloudflare Pages project: **perfectstudyspace**.
Release order: database verification → secrets → backend functions → frontend → live tests → activate tested schedules.
The owner chose to perform Cloudflare and Supabase actions manually. No remote deployment or live
payment/AI/job test should be considered completed merely because the source was pushed.

**Current release gate: FAILED — production deployment remains pending**

Fresh-checkout verification passed the frontend build, 109 unit tests, shared AI module type
checks and 29 of 30 server suites. The full predeploy command failed on seats_test.ts:
"R2: coming back later the same day adds no second free day". A focused diagnostic reproduced
two concurrent check_in_member requests both succeeding (one free_day and one no_desk), leaving
two active member sessions. After checking out one, the later request is refused as already
checked in. Compensation is issued once, but the active-session race remains.

This code/test existed before the AI provider changes. The relevant seat/session files were
not changed by this release. A focused run can pass when one concurrent request sees the first
booking earlier; that does not resolve the race. The full gate failed twice during this release
attempt. Do not treat the earlier 29 October all-pass run or a later lucky rerun as a repair.

The current push publishes reviewed source and manual instructions. Resolve the reproduced
check-in race and rerun predeploy successfully before production deployment or seat automation
activation. The following deployment steps are the runbook for after that gate is satisfied.

The first Windows clone also exposed a CRLF/hashbang import issue in the predeploy unit test;
normalizing that isolated checkout to repository LF endings made its six tests pass without
source-code changes. Dependency audit reported two existing high-severity development-tool
findings (vite and source-map-js); the production-dependency audit reported zero findings.

**1. Supabase website: database and secrets**

1. Open the confirmed Supabase project, then SQL Editor as postgres.
2. Run [full-system-diagnostic.sql](full-system-diagnostic.sql). Your previous report passed the
   required application schema, including agent_runs.provider_attempts; do not reapply every
   migration merely to fix the missing scheduler. If this column is actually missing, apply
   [073_ai_provider_attempts.sql](../../supabase/migrations/073_ai_provider_attempts.sql).
3. Open Edge Functions → Secrets and follow [SUPABASE-SECRETS.md](SUPABASE-SECRETS.md).
   Preserve valid existing signing values. The AI key names are OLLAMA_API_KEY, GEMINI_API_KEY
   and AI_API_KEY. The CRON_SECRET value must match the existing Vault pss_cron_secret.
4. Include https://perfectstudyspace.pages.dev in ALLOWED_ORIGINS, retaining the other origins
   still used. The default source list contains a different, hyphenated Pages origin.
5. Set PORTAL_URL to https://perfectstudyspace.pages.dev if students use the same site; otherwise
   use their actual deployed site's origin without a /me suffix. Signup routing is a separate
   known code gap; changing PORTAL_URL alone does not repair the self-signup redirect.
6. Run [prepare-missing-schedules.sql](prepare-missing-schedules.sql) if schedules are missing.
   It installs pg_cron and creates 27 missing schedules paused. Existing jobs are preserved.

**2. Deploy the complete backend from your terminal**

These functions import shared files and many API domain modules. Use the full checked-out source,
not an index.ts copied alone into an empty Dashboard editor. In PowerShell, from a clone of the
correct repository/branch containing these changes:

```powershell
git switch pss-ai/all-phases
git pull --ff-only origin pss-ai/all-phases
supabase login
supabase functions deploy api --project-ref zripsszkprhtyccukrir --no-verify-jwt --use-api
supabase functions deploy agent --project-ref zripsszkprhtyccukrir --no-verify-jwt --use-api
supabase functions deploy cron --project-ref zripsszkprhtyccukrir --no-verify-jwt --use-api
supabase functions list --project-ref zripsszkprhtyccukrir
supabase secrets list --project-ref zripsszkprhtyccukrir
```

Stop and resolve a failed deploy before proceeding to frontend deployment. --use-api bundles
server-side without Docker. The gateway JWT option matches this app's config: api and agent
validate custom staff/student tokens, while cron jobs validate x-cron-secret. Their own
authorization remains enforced. Verify all three functions show the new deployment time.

**3. Cloudflare website: deploy the frontend**

Open Workers & Pages → perfectstudyspace → Settings. Locate the Git/build configuration
(the exact grouping can appear as Builds & deployments or Build).

| Field | Value |
|---|---|
| Repository | perfectstudyspacedev-sys/PerfectStudySpace |
| Production branch | pss-ai/all-phases |
| Framework preset | React (Vite) |
| Root directory / build root | Leave empty; package.json is at repository root |
| Build command | npm run build |
| Build output directory | dist |
| VITE_SUPABASE_URL, Production environment | https://zripsszkprhtyccukrir.supabase.co |
| VITE_SUPABASE_ANON_KEY, Production environment | The public anon key from this same Supabase project |

1. Save the settings. Apply the same public build variables to Preview only if you use previews.
2. Verify VITE_SIGNUP_SITE_URL separately against your actual signup host; the known same-site
   signup redirect is outside this release's requested fixes. Do not assume setting it to this
   site's /join solves the issue.
3. Open Deployments and deploy/retry the **newest commit on pss-ai/all-phases**. Confirm the
   displayed commit is the newly pushed release, not an older failed deployment.
4. Wait for the build and deployment to report success, then open https://perfectstudyspace.pages.dev.
5. View page source: the module script should be a compiled /assets/...js file. It must no longer
   load /src/main.jsx. A public HTTP check before this release still found the raw JSX entry.
6. Hard refresh, open the staff login and /me/login, and refresh a nested route directly.
7. In browser Network, verify requests target zripsszkprhtyccukrir.supabase.co and CORS succeeds.

Cloudflare builds the committed branch. It does not read the developer's .env or generated
signing-values file. AI/service-role/signing credentials belong only in Supabase.

**4. First live checks**

| Check | Action | Required evidence |
|---|---|---|
| Staff login | Sign in with a known owner, then a branch staff test account; log out and sign in again. | Correct account/branch scope; owner pages restricted; no login/CORS errors. |
| Student login | Create setup codes for two test students, set their PINs through /me/setup, then log in separately. | Student A cannot read Student B; wrong PIN limits and logout invalidate access. The previous report contained zero PIN setups. |
| AI preference | With all intended keys configured, Owner → Analyst → AI models, then ask one narrow factual report question. | Actual answer model and a new successful agent_runs row; expected first eligible provider Ollama. Key configured alone is insufficient. |
| Structured AI | In staging, run a representative ID/payment extraction or supported structured-draft evaluation. | Ollama skipped for capability; Gemini or Claude supplies schema-valid output; accuracy reviewed. |
| Fallback | In staging, exercise one provider outage using its test configuration, then restore it. | Ordered attempts, next eligible provider, no repeated business action; a refusal does not switch providers. |
| Monthly cap | In staging, set AI budget to zero, ask a question, then restore the original value. | Call blocked before inference; all provider paths respect the shared cap. |
| Payments | Use a separate staging project and test memberships/proofs. Test quote, submission, owner confirmation, rejection, duplicate UTR and concurrent confirmation. | Correct amounts, exactly one expected financial effect, separate student isolation, no duplicate credit. No invented payments against real memberships. |
| Storage | Upload representative non-sensitive test files, open through the app, then test expired/unauthorized access. | Required private buckets work through signed links; private URLs are not publicly readable. |
| QR check-in | Configure a test branch's coordinates/key, create its poster and test with a test student. | Consent, accuracy/radius checks, correct desk/session and checkout. Previously no branch had full setup. |

For all 44 feature walkthroughs use [PSSAI-FEATURE-TESTING.md](../PSSAI-FEATURE-TESTING.md).
Keep pssai_agent_shadow=on during chat evaluation. Existing signup, Food Pass concurrency,
cross-branch desk, referral validation, portal focus input and duty-permission gaps are excluded
from this push/deploy-only request and should remain recorded as open findings.

Inspect recent AI results in SQL Editor:

```sql
SELECT started_at, agent, model, status, model_calls, tool_calls,
       tokens_in, tokens_out, cost_usd, provider_attempts
FROM public.agent_runs
ORDER BY started_at DESC
LIMIT 20;
```

The repository's full database integration suites create records. Run them against staging,
following tests/integration/README.md; a skipped suite without a database is not live validation.

**5. Test and activate schedules individually**

After functions and secrets are verified, begin with the integrity report. Run this on its own:

```sql
SELECT public.pss_run_cron_job('cron_integrity_report') AS request_id;
```

Wait a few seconds after that statement commits. Then inspect the response for that request
and the corresponding Edge logs/system event. A request ID or HTTP 200 alone is insufficient:
the body/action outcome can report skipped work. These responses are private operational data;
share a redacted outcome, not credentials or personal records.

```sql
SELECT id, created, status_code, timed_out, error_msg, content
FROM net._http_response
ORDER BY created DESC
LIMIT 5;

SELECT occurred_at, action, ok
FROM public.events
WHERE actor_type = 'system'
ORDER BY occurred_at DESC
LIMIT 10;
```

Once the integrity job itself succeeds, activate only its prepared schedule:

```sql
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'pss_integrity_report'),
  active := true
);
```

Test the AI brief separately after the first successful Analyst request:

```sql
SELECT public.pss_run_agent_job('owner_brief') AS request_id;
```

After it commits and completes, verify the response, agent_runs and today's owner_briefs record.
An existing brief or missing eligibility can legitimately cause skipped work. Activate
pss_owner_brief only after the expected outcome is understood. Follow the same per-job method
for the remaining names/actions in [cron.sql](cron.sql); use that file as a reference, rather than
rerunning its placeholder-based setup or blindly activating all jobs.

Once server housekeeping schedules are tested and active, enable pssai_cron as described in
the feature checklist. That setting transfers the old page-load housekeeping; it does not
start cron jobs. Rerun the diagnostic and retain the results alongside manual test evidence.

**Recovery**

Record the prior api/agent/cron deployment versions and Cloudflare production deployment before
changing them. On a regression, redeploy the previous backend source and use Cloudflare's prior
successful deployment for frontend rollback. Migration 073 is additive; leaving its trace column
in place is compatible with the old code. Pause an individual scheduled job using active:=false.
Application flags can stop feature use, but they do not undo payments, notices, holds or completed jobs.

References: [Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[production branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/),
[Supabase function deployment](https://supabase.com/docs/guides/functions/deploy),
[Cron activation and history](https://supabase.com/docs/guides/cron/quickstart).
