**Supabase Edge Function secrets — complete source inventory, 30 October 2026**

Project: zripsszkprhtyccukrir. Set custom values in Supabase → Edge Functions → Secrets.
This document contains configuration and instructions only, never actual API keys or signing values.

| Name | Value / source | Used for |
|---|---|---|
| OLLAMA_API_KEY | Your Ollama account API key from https://ollama.com/settings/keys | First-choice eligible inference |
| GEMINI_API_KEY | Your Google AI Studio Gemini API key | Second-choice inference; first eligible structured output |
| AI_API_KEY | Your Claude Console API key; preserve it if already valid | Claude fallback |
| STAFF_JWT_SECRET | Preserve the existing custom staff signing secret. Set a new generated value only if neither this nor a working JWT_SECRET exists. | Staff tokens |
| JWT_SECRET | Legacy alternative to STAFF_JWT_SECRET; preserve an existing working value. STAFF_JWT_SECRET takes precedence when both are present. | Staff-token alias; not a provider key |
| STUDENT_JWT_SECRET | Preserve the existing value; if absent use its own distinct generated random value. | Student tokens |
| CRON_SECRET | Exact existing Vault value named pss_cron_secret, not a newly generated replacement. | Scheduler authentication shared by agent and cron |
| CERTIFICATE_SECRET | Preserve the existing value; if absent use its own distinct generated random value (at least 16 characters). | Certificate signatures |
| PORTAL_URL | https://perfectstudyspace.pages.dev if students use that same site; otherwise the actual deployed student site's origin. No /me suffix. | Portal setup, QR, referral, certificate and family links |
| ALLOWED_ORIGINS | Comma-separated origins including https://perfectstudyspace.pages.dev; retain the other sites still in use. Example below. | Browser CORS |

Example CORS value retaining the existing source defaults and adding the confirmed Pages origin:

```text
https://perfectstudyspace.pages.dev,https://perfect-study-space.pages.dev,https://join.perfectstudyspace.in,https://perfectstudyspace.in,https://www.perfectstudyspace.in,http://localhost:5173
```

The setting replaces the built-in list. Individual origins have no URL paths. It does not automatically
allow arbitrary Cloudflare preview origins; add a specific preview origin when intentionally used.

**Optional model overrides**

These values are already the defaults in the local provider router. Leaving the overrides absent
uses these defaults. They require deployment of the provider-aware code to apply.

| Name | Value |
|---|---|
| OLLAMA_MODEL | gemma4:31b |
| OLLAMA_MODEL_HARD | gpt-oss:120b |
| GEMINI_MODEL | gemini-3.8-flash |
| GEMINI_MODEL_HARD | gemini-3.8-flash |
| AI_MODEL | claude-haiku-5-5 |
| AI_MODEL_HARD | claude-sonnet-5-5 |

PUBLIC_SITE_KEY is optional for this application's operation and required only if the separate
marketing website uses public_create_enquiry. Preserve the same value the marketing form submits
as siteKey. The value is visible to users of that static form, so it is only a soft spam deterrent.
It is not an AI provider key or a student login secret.

**Retrieve your existing cron value yourself**

Run only in your project's SQL Editor as postgres and copy the returned value directly to the
CRON_SECRET field. Do not post or commit the returned value:

```sql
SELECT decrypted_secret AS cron_secret_for_edge_functions
FROM vault.decrypted_secrets
WHERE name = 'pss_cron_secret';
```

The previous diagnostic confirmed exactly one non-placeholder value. SQL diagnostic PASS does
not establish that it already matches the Edge Function secret.

**New signing values if missing**

Three distinct 256-bit signing values were generated into the ignored local file
.tmp/supabase-new-signing-secrets-2026-10-30.env. Use only the lines for secrets that are missing.
Do not bulk-import this file over a working deployment. It deliberately excludes CRON_SECRET
and all account API keys. No new signing value was deployed.

Changing either staff/student signing secret invalidates existing tokens. Changing the certificate
secret prevents previously issued certificates from validating with the new key. Retain valid values.

**Supabase-managed values**

The code reads SUPABASE_URL (expected https://zripsszkprhtyccukrir.supabase.co) and
SUPABASE_SERVICE_ROLE_KEY. Supabase provides these automatically in deployed Edge Functions.
Do not add them as custom secrets; the SUPABASE_ prefix is reserved. The root frontend's
VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY belong to Cloudflare build configuration.
No VITE_ secret is needed in Supabase for this backend.

AI feature switches, budgets, UPI payee settings and business/grievance contacts belong in
app_settings or the corresponding owner settings screens. They are not additional Edge secrets.

Sources: [Supabase secrets and reserved variables](https://supabase.com/docs/guides/functions/secrets),
[Ollama Cloud authentication](https://docs.ollama.com/cloud),
[Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key),
[Claude API setup](https://platform.claude.com/docs/en/api/overview).
