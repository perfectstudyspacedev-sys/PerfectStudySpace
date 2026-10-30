**Perfect Study Space — feature testing checklist**

**Provider update (29 October 2026):** the application now routes eligible requests through
Ollama Cloud → Gemini → Claude. Apply migration 073 and see [AI-PROVIDERS.md](ops/AI-PROVIDERS.md)
for backend keys, capability limits and tests. Structured tasks start with Gemini because Ollama
Cloud does not support schema-enforced output. References to Claude/AI_API_KEY below describe
the original provider configuration; supported alternatives now use OLLAMA_API_KEY and
GEMINI_API_KEY. The earlier exported PDF is a snapshot from before this provider addition.
Latest provider-change verification: npm run predeploy passed the build, 109 unit tests and all
30 server suites. The Windows Deno launcher issue noted in the original audit below is fixed.
Live provider calls remain unverified. See the provider guide for the intermittent existing seat test.

Confirmed deployment details: [perfectstudyspacedev-sys/PerfectStudySpace, branch pss-ai/all-phases](https://github.com/perfectstudyspacedev-sys/PerfectStudySpace/tree/pss-ai/all-phases);
Supabase `zripsszkprhtyccukrir`; Cloudflare Pages `perfectstudyspace`. The local CLI project ref
has been corrected. Run [the single SQL diagnostic](ops/full-system-diagnostic.sql) for current
database readiness; it does not execute runtime feature tests.

Prepared 29 October 2026 from this workspace, local checks and read-only HTTP probes of https://perfectstudyspace.pages.dev.

**Readiness and evidence**

- Found **49 settings: 44 feature switches, 4 numeric controls and 1 shared chat shadow-mode control**.
- **All live UI feature tests are currently blocked by the frontend deployment.** The live root HTML references /src/main.jsx; that resource returns text/jsx containing uncompiled imports and JSX. Publish the Vite build output, not the source tree.
- Local verification completed: npm test passed **109 tests**; all **29 server suites** passed through the installed Deno executable; npm run build passed. The normal npm run test:server launcher fails on Windows with spawnSync ...deno.cmd EINVAL. These server suites use a fake Supabase and scripted AI; they do not prove the production database, real AI, or browser flows.
- Supabase management verification failed with **401 Invalid access token**. Live migrations, function versions, secrets, storage and job execution are therefore **unverified**. No production settings, payments, messages or records were changed.
- An OPTIONS probe to the locally configured API accepted Origin https://perfectstudyspace.pages.dev and the Idempotency-Key header. CORS is therefore not the observed immediate blocker for that endpoint.
- The page's raw source does not establish which Supabase URL a correctly built Cloudflare deployment will use; verify the build environment.
- Status below describes implementation after the shared deployment baseline is fixed: **Ready** = implemented and suitable for manual verification; **Setup** = configuration/jobs required; **AI** = real API and evaluation required; **Data** = qualifying history required; **Partial/Hold** = a specific gap/gate remains. None means already tested successfully in production.

**A. First correct the deployment and establish the baseline**

1. Cloudflare Pages → your project → build settings: project/root directory is the directory containing package.json, build command **npm run build**, build output directory **dist**. Rebuild the GitHub commit containing this source. The static React/Vite deployment uses compiled assets from that output. [Cloudflare React guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).
2. Set Cloudflare build variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the **same intended Supabase project**. Vite embeds these at build time; rebuild after changing them. Never put the service-role or AI key in Cloudflare frontend variables.
3. Use the confirmed project **zripsszkprhtyccukrir**. Both the local frontend environment and supabase/config.toml now target it. Verify Cloudflare's build environment also uses that project; use an explicit project ref when deploying functions.
4. Correct student URLs for the actual hosting arrangement. Portal on your current origin is **https://perfectstudyspace.pages.dev/me**. PORTAL_URL should be **https://perfectstudyspace.pages.dev**, with no /me or /join suffix. The local VITE_SIGNUP_SITE_URL is https://perfectstudyspace.pages.dev/join: App's /join/:code handler redirects to the exact same URL, producing a loop. The current route implementation must be adjusted for same-origin signup, or use a configured join.* hostname that loads JoinApp; do not simply append /join and expect a separate student app.
5. Supabase → verify all migrations **001–072** are applied in order. If applied manually, table existence is a useful check but is not proof every column/index/function is present. Prefer the migration history when available.
6. Supabase → deploy **api**, **cron** and **agent** from the matching source. Gateway JWT verification is off for these functions because they validate their own staff/student JWT or cron secret. GitHub → Cloudflare deploys the frontend; it does not by itself deploy these functions or apply SQL migrations. [Supabase function deployment](https://supabase.com/docs/guides/functions/deploy).
7. Check backend secrets: STAFF_JWT_SECRET (or existing JWT_SECRET), STUDENT_JWT_SECRET, CRON_SECRET, PORTAL_URL and ALLOWED_ORIGINS as appropriate. Include your exact origin https://perfectstudyspace.pages.dev. AI features additionally need AI_API_KEY; certificates additionally need CERTIFICATE_SECRET. Do not paste secrets into the checklist/chat.
8. Check private Storage buckets payment-proofs, id-photos and task-photos. Run the correct migrations rather than opening these buckets to anonymous upload.
9. Enable pg_cron/pg_net, configure the two SQL helper functions/Vault entries in docs/ops/cron.sql for the intended project, and install its schedules. A flag alone does not create schedules.
10. Verify the rebuilt HTML references /assets/...js instead of /src/main.jsx. Check login and /me/login, /me/setup, /ask and a public verification link. Open DevTools Network/Console and confirm requests go to the intended Supabase URL with no MIME/import/CORS errors. Check the public/_headers policies are actually present on the deployed response.
11. Use an owner login, a branch staff login, two distinct student portal logins and a kitchen/housekeeping account where relevant. Prefer a separate staging Supabase project for invented payments, forced cron runs, fabricated history and collision tests. A Cloudflare preview alone still uses whichever backend was embedded at build time.
12. Prepare two branches, a temporary member, a permanent member with cabin, a returning member, a locker, Food Pass balance, menu/inventory records, tasks and enquiries. Name test records clearly. Record before/after IDs and amounts for each test.
13. Switch on only the feature under test and its listed dependencies. Fully reload staff tabs after each settings change: feature flags are cached in browser memory for up to ten minutes, and the retirement flag is cached server-side for up to one minute.

**B. Correct the blanket all-off operation**

Your query changes existing pssai_ rows only. It does not insert missing flags; missing feature flags already default off. It also overwrites numeric values and turns chat review OFF.

Use this to inspect the actual settings, then restore the non-feature controls intentionally:

~~~sql
SELECT key, value, updated_at
FROM public.app_settings
WHERE key LIKE 'pssai\_%' ESCAPE '\'
ORDER BY key;

-- Re-enable staff review before testing either chat.
INSERT INTO public.app_settings (key, value)
VALUES ('pssai_agent_shadow', 'on')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();

-- Example test controls: choose your own budget/thresholds rather than treating these as flags.
INSERT INTO public.app_settings (key, value) VALUES
  ('pssai_ai_budget_usd', '10'),
  ('pssai_public_ai_daily', '40'),
  ('pssai_enquiry_ai_daily', '150'),
  ('pssai_discount_confirm_over', '1000')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();

-- Template: enable one named feature, including a previously missing row.
INSERT INTO public.app_settings (key, value)
VALUES ('pssai_portal', 'on')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();
~~~

To disable a tested feature, use the same last statement with its key and off. Do not blanket-reset numeric settings again. These examples are instructions for you to run deliberately; I have not executed them.

| Setting | Correct type / default in code | How to test |
|---|---|---|
| pssai_agent_shadow | on = staff-reviewed draft; off = direct replies/actions within allowed rules | Test concierge and enquiry in on mode first; off affects both. Missing/other values keep review on. |
| pssai_ai_budget_usd | Nonnegative USD number, default 10 | On staging set 0: AI should be skipped/refused with a budget reason. Restore your chosen budget. Limits are checked before runs; this is not a provider-enforced exact spending cap for concurrent/in-flight runs. |
| pssai_public_ai_daily | Nonnegative count, default 40 | On staging set 0: automatic public-triggered ID/payment image reads should be skipped while submission is retained. Restore your choice. Manual owner reads use their own route and are not stopped by this public quota. |
| pssai_enquiry_ai_daily | Nonnegative count, default 150 | On staging set 0: public chat should keep the message and hand off without another AI reply. Restore your choice. |
| pssai_discount_confirm_over | Positive rupee number, default 1000 | Use a test discount/fixed cashback above the threshold: the extra confirmation appears; cancel it and verify nothing is saved. It is always a safety confirmation, not an on/off feature. |

An off string for these numeric settings is not interpreted as a zero budget/limit: the current code falls back to defaults. All feature flags off also does not stop core billing, audit/idempotency, integrity jobs, base cleanup/expiry cron jobs or the owner's manual screenshot reader.

Claude model defaults in source are claude-haiku-5-5 and claude-sonnet-5-5, overrideable with backend secrets AI_MODEL and AI_MODEL_HARD. These IDs are listed in the current [official model overview](https://platform.claude.com/docs/en/models/overview); your account's actual access/billing still needs a live check.

**C. Test all 44 feature switches**

For each item, enable its full pssai_ key with the SQL template above, enable its dependencies, reload and follow the numbered steps. Common baseline blocker A applies to every live UI test.

**01. `pssai_cron` — Scheduled housekeeping**

Status: **Setup**. Requires: Cron extensions, Vault configuration, cron function and schedules.

1. Enable the switch only after the schedules exist. Run cron_integrity_report, then cron_expiry_alerts using the job instructions below; open Dashboard and Membership.
2. Check: Expect a fresh data-check report and one expiry alert per eligible member, without duplicate reminders after a second run. Verify expired-signup and retry-key cleanup using old TEST records in a staging database.
3. Readiness limit: This switch transfers reminder/cleanup work away from page loads; it does not start, stop or disable all cron jobs.

**02. `pssai_portal` — Student portal and PIN login**

Status: **Setup**. Requires: STUDENT_JWT_SECRET; migrations 058–062; business privacy/contact settings.

1. Enable portal. Staff: Students → a test student's profile → Portal setup code. Open /me/setup in a separate browser, enter phone, code, a valid six-digit PIN and accept privacy. Open /me/login, log in and inspect Home, Report, Receipts, Inbox, More.
2. Check: Wrong PINs lock after five tries for 15 minutes; setup codes are one-time and expire after 24 hours. Student A must never see Student B's details. Logout must invalidate that session.
3. Readiness limit: Code is implemented. Live availability needs the deployment baseline. Holds up to seven days on a temporary plan run once a month; longer/permanent/second holds queue in Approvals. Refund, plan-change, privacy and waitlist approvals still need a person to finish the work.

**03. `pssai_focus_pulse` — Focus rating after staff checkout**

Status: **Partial**. Requires: Completed temporary/permanent member session; migration 055.

1. Enable the switch. Staff: Bookings → check out a test member → choose a rating from 1 to 5. Repeat with Skip on another completed session. Open the student's portal Report.
2. Check: One focus_ratings row per rated booking; Skip writes nothing; walk-ins are not asked. The report should show the saved rating.
3. Readiness limit: The prompt exists only on staff checkout. Portal self-checkout has no rating prompt and record_focus_rating permits staff callers only. A student-only focus collection flow is unfinished; use staff checkout to create ratings for the later focus features.

**04. `pssai_anomaly` — Owner anomaly flags**

Status: **Data**. Requires: First real ML export/run/publish; migrations 055–057.

1. Enable the switch after publishing ML results. Owner: Flags → inspect a flag → mark It's fine or Problem. Reload and check the verdict remains.
2. Check: Flags show an explanation, reference and score. Republishing does not overwrite reviewed verdicts or duplicate existing flags. Session-watch operational flags may also appear here.
3. Readiness limit: The ML pipeline runs outside Supabase and needs real data. An empty page is expected before publishing or when nothing qualifies. Two weeks of owner review are still needed to judge false alarms.

**05. `pssai_analyst` — Owner AI analyst and morning brief**

Status: **AI**. Requires: agent function; AI_API_KEY; positive AI budget; optionally published ML results.

1. Enable analyst. Owner: Analyst → ask yesterday's collections for a named branch and compare with Revenue for exactly the same dates. Ask for a refund action, then a question whose data does not exist. Try Deep answer. Run owner_brief through the agent job helper and inspect Dashboard.
2. Check: Figures match the existing screens, unsupported questions admit missing data, and asking for a refund changes no money. agent_runs records usage and tool events. The brief is produced once for the day.
3. Readiness limit: Needs a working Claude API account/key and real evaluation. Without ML publication, score/forecast answers lack data. Run tests/agents/analyst-eval.md; the repository target is at least 18/20 correct.

**06. `pssai_upi_pay` — Portal UPI payment and owner confirmation**

Status: **Setup**. Requires: portal; upi_vpa and upi_payee_name; private payment-proofs bucket; migration 067.

1. Enable portal and upi_pay. Student: /me/pay → choose dues, renewal, locker or Food Pass top-up → note the quoted amount/reference → submit a test proof. Owner: Approvals → inspect proof → confirm only a payment actually received, or reject with a reason.
2. Check: Before confirmation no new payment is credited. Confirmation runs the matching existing billing action once and appears in Receipts/Revenue. A second confirm and a UTR already confirmed on another proof must be refused. A rejected proof shows its reason to the student.
3. Readiness limit: Implemented without a bank gateway: owner verification is part of the intended workflow. Use a staging database for invented receipts and test duplicate/racing confirmations there.

**07. `pssai_proof_reading` — Automatic AI reading of payment screenshots**

Status: **AI**. Requires: upi_pay; AI_API_KEY; AI budget; supported screenshot JPEG/PNG/WebP under 1.5 MB.

1. Enable the switch. Submit the first screenshot for a new test payment; inspect Approvals for extracted amount, UTR, payee and confidence. Try a mismatched amount/payee, unclear image and replacement screenshot.
2. Check: The proof is saved even if AI fails. Mismatches appear as warnings; AI never confirms the payment. A replacement does not automatically spend another read; the owner can request Read with AI.
3. Readiness limit: This flag controls automatic reads. The owner's manual Read with AI action does not check this flag, so switching it off is not a global AI stop. Live image accuracy needs real evaluation.

**08. `pssai_auto_approve` — Signup plan, PIN, ID and UPI onboarding**

Status: **Blocked by signup URL**. Requires: portal and upi_pay; working branch signup link; id-photos bucket; optional AI key for ID checks.

1. After the signup URL fix, enable the switch. Staff: copy a branch signup link. New test student: submit details → select plan → set PIN → attach ID if requested → pay/submit proof. Owner: Approvals → confirm → check Students and the new login.
2. Check: No student/membership is created before the owner confirms or staff registers it. Confirmation creates one membership and corresponding payment. A returning student's existing PIN must not be replaced.
3. Readiness limit: The name does not mean unattended bank approval. Local VITE_SIGNUP_SITE_URL currently produces a self-redirecting /join link on your domain; fix/redeploy first. AI ID checks are conditional on API setup and quotas.

**09. `pssai_concierge` — Student AI chat assistant**

Status: **AI / shadow pilot**. Requires: portal; agent function; AI key/budget; pssai_agent_shadow=on initially.

1. Enable concierge and leave shadow on. Student: /me/chat → ask about own dues in English, Tamil and Tanglish. Owner/staff: Chat replies → inspect, edit and send a draft. Ask to access another student or grant a refund.
2. Check: In shadow mode the draft waits for staff, and chat tools do not place a hold or create a payment request. Financial facts must match the student's own account. Later, only after evaluation, test direct replies with shadow off on test accounts.
3. Readiness limit: Live-model accuracy and the two-week shadow pilot are outstanding until performed. Your blanket SQL sets shadow off, so restore it before enabling this feature. Eval: tests/agents/concierge-eval.md.

**10. `pssai_collections` — Renewal and dues reminder send list**

Status: **Setup**. Requires: Active members with upcoming expiry/dues; agent function and collections schedule; portal for student notices.

1. Enable collections. Run the collections agent job. Owner: Send list → compare ranked members, reasons and quoted dues with profiles → open a WhatsApp draft → mark sent/skipped. Run the job again.
2. Check: Eligible students receive portal notices when appropriate; the list does not duplicate the same day's reminder. Nothing is automatically sent through WhatsApp. Amounts come from billing code.
3. Readiness limit: Basic ranking/templates work without an AI key. Personalized AI wording requires AI setup. A branch with no qualifying accounts correctly yields an empty list.

**11. `pssai_ai_messages` — AI welcome and study-report drafts**

Status: **AI**. Requires: agent function and AI key/budget; a welcome template or report with study history.

1. Enable the switch. Staff: Membership → welcome message → AI draft; then request a study report for a test member and draft its message. Compare dates, hours, prices and links with the standard message.
2. Check: The draft can be edited before the user opens WhatsApp. Added numbers, missing required links or missing sign-off cause a fallback/refusal; no automatic send.
3. Readiness limit: Implemented, but live text quality needs evaluation. Missing AI setup leaves standard messaging available. Check tests/server/writer_live_test.ts and the saved agent evaluations.

**12. `pssai_realtime` — Live refresh across staff tabs**

Status: **Setup**. Requires: Updated public/_headers; working Supabase Realtime broadcasts; two staff browsers/tabs.

1. Enable realtime and fully reload both tabs. Open the same branch's dashboard/bookings. Make a test check-in, checkout or task update in tab A; observe tab B without manually refreshing. Repeat on a different branch.
2. Check: Tab B refreshes after the broadcast/debounce, usually within a few seconds. Another branch must not receive personal records; broadcasts carry only a changed signal. API reads still authorize access.
3. Readiness limit: Implementation is present. Live websocket connectivity is unverified. Polling is retained as a slower safety net; the portal itself still uses page refresh/polling for many views.

**13. `pssai_session_reminders` — Session ending notice**

Status: **Setup**. Requires: portal; a non-paused active session ending within the next ten minutes; scheduled job.

1. Enable the switch. Use a TEST session whose booked end is within ten minutes; run cron_session_reminders. Student: Inbox/Home → inspect the notice. Run it a second time.
2. Check: One notice for that session; paused sessions are excluded. With self-checkout available, the notice directs the student appropriately.
3. Readiness limit: The job must be installed and running; this is an in-app notice, not a WhatsApp message or phone push notification.

**14. `pssai_waitlist_offers` — Permanent-seat offers**

Status: **Setup / manual finish**. Requires: portal credentials for the waitlisted student; an available desk; waitlist records; scheduled job.

1. Enable the switch. On staging, put a test student on a full branch's waitlist, then free a desk. Run cron_waitlist_offers. Student: Home → accept or decline the offer. Owner: Approvals → inspect acceptance.
2. Check: Oldest eligible waiting student gets a 24-hour offer. A seat is not offered twice while an offer/accepted request holds it. Acceptance queues for staff/owner completion.
3. Readiness limit: Acceptance does not itself move the student to a cabin; a person completes the plan/seat assignment. A non-portal student is left for desk handling.

**15. `pssai_portal_r2` — Portal waitlist and cashback pages**

Status: **Ready**. Requires: portal; permanent-seat eligibility; referral_links additionally for personal referral links.

1. Enable portal_r2. Student: More → Your own cabin (waitlist) and Bring a friend & cashbacks. Join/leave the waitlist and inspect own cashback history; compare with staff records.
2. Check: Only the student's own records appear. Waiting/fulfilled/cancelled state and pending/redeemed cashback amounts match the staff app.
3. Readiness limit: An umbrella for these pages, not a replacement for the separate referral_links, hour_release or next_exam switches. Empty cashback history is a valid result.

**16. `pssai_hour_release` — Member releases cabin hours for resale**

Status: **Conditional / seat issue**. Requires: portal; permanent member with an assigned cabin; future free time window.

1. Enable the switch. Student: More → Release your hours → release a window. Staff: Walk-in → choose the released window and sell it. Owner: Growth → Seat resales; student: inspect pending cashback. Try selling the same window twice and cancelling unsold hours.
2. Check: Only one sale claims the window; unused fragments remain available. Member-released hours earn 50% of resale money as pending cashback. Test the original member arriving during a sold window and the alternative-seat outcome.
3. Readiness limit: Core flow is built. Do not approve a broad multi-branch pilot until the cross-branch permanent-member desk issue in the remaining-work list is fixed and concurrency tests run on real Postgres.

**17. `pssai_overbooking` — Predict unused cabin hours**

Status: **Data / controlled pilot**. Requires: Permanent cabin members with at least 14 usable history days within 28 days; job; branch fallback seats.

1. Enable overbooking on staging. Run cron_predict_releases; inspect released windows in the walk-in flow/Growth → Seat resales. Sell a prediction, then have the original member arrive; test both a free fallback desk and no free desk.
2. Check: Insufficient history produces no offers. Offered windows apply the 20% time safety margin. Arrival is handled with a fallback or the specified free-day credit; the same collision must not award duplicate credit.
3. Readiness limit: Needs history and a real collision pilot. Local tests do not prove database race behavior. The shared cross-branch cabin issue must be resolved before general rollout.

**18. `pssai_yield_pricing` — Daily walk-in price changes**

Status: **Ready / data for automation**. Requires: Base fee_config; jobs for automatic prices; optional confirmed exam and attendance history.

1. Enable the switch. Owner: Growth → Walk-in prices → set today's test-branch change to +10%. Open Walk-in and compare with the base price; submit a valid test booking. Change the price while an old form is open and try submitting that stale quote. Restore automatic pricing.
2. Check: The displayed and recorded amount follows the server quote. Out-of-range changes beyond owner limits/±20% are refused; stale prices are refused before billing.
3. Readiness limit: Manual test works immediately after baseline. Automatic pricing needs same-weekday history over four weeks; with no history a base/no-change result can be correct.

**19. `pssai_enquiry_chat` — Public enquiry assistant**

Status: **AI / shadow pilot**. Requires: /ask route; agent function; AI key/budget; pssai_agent_shadow=on.

1. Enable the switch. Logged-out visitor: /ask → choose branch and start a test enquiry with a test phone. Ask about plans, then something outside the supplied facts. Staff: Enquiries → open that enquiry's Website chat → review/send/edit/discard draft.
2. Check: In shadow mode the visitor is told the team will reply. Facts/prices match the app; messages survive AI outages; rate limits stop repeated AI use. Public visitors cannot read other chats.
3. Readiness limit: Requires live AI evaluation and valid deployed routing. The shared shadow switch also controls concierge; turning it off affects both. Eval: tests/agents/enquiry-eval.md.

**20. `pssai_lead_tools` — Lead scores and duplicate suggestions**

Status: **Setup / AI for duplicates**. Requires: Open enquiries with activity/follow-ups; scoring and dedupe jobs.

1. Enable lead_tools. Create several TEST enquiries with different activity and a plausible duplicate pair with similar names but different phones. Run cron_score_enquiries and enquiry_dedupe. Staff: Enquiries → inspect score explanation and Possibly the same person → review/merge or dismiss.
2. Check: Scores update from deterministic facts. Duplicate suggestions require review; no AI merge occurs by itself. A dismissed suggestion stays dismissed.
3. Readiness limit: Scoring works without AI; duplicate judgment needs the AI key/budget and qualifying pairs. No candidates is a valid empty result. Eval: tests/agents/dedupe-eval.md.

**21. `pssai_referral_links` — Campaign and friend referral tracking**

Status: **Blocked by signup URL / setup**. Requires: Migration 065; valid student-site base URL; referral conversion job; optional referral_reward_amount.

1. Fix the student signup URL first, then enable referral_links. Owner: Growth → Referral links → create a campaign link. Open it logged out → sign up or chat → register the test student → run cron_referral_conversions. For friend rewards also enable portal_r2 and use a student's personal link.
2. Check: Campaign signups/chats/joins increase once. A configured friend reward enters Approvals and only becomes cashback after owner approval. Deactivating a link makes it stop working.
3. Readiness limit: The attribution code exists. Signup navigation currently has a local URL loop. Reward amount defaults to zero, so no reward is expected until configured. The signup form's source validation also needs the source case noted under remaining work.

**22. `pssai_exam_radar` — Import public exam notice suggestions**

Status: **AI / external-source check**. Requires: AI key/budget; exam_sources or default official pages; agent job; readable permitted pages.

1. Enable exam_radar. Run exam_radar, then Owner: Growth → Exam calendar. Open each source and compare exam/date/application deadline; confirm a correct suggestion and dismiss a wrong one. Add a manual notice to verify the fallback.
2. Check: Imported items start as suggestions and only confirmed notices affect downstream features. A robots restriction or unreadable page is reported, not invented.
3. Readiness limit: The source fetcher and review UI are built. Current exam-site accessibility/extraction quality is not verified; this needs a live run and tests/agents/exam-radar-eval.md.

**23. `pssai_winback` — Past-member offers**

Status: **Setup / AI optional**. Requires: Inactive former members meeting exam-cycle/recent-exit rules; winback_discount_pct at most 10; job.

1. Enable winback. Set a test offer percentage. Run the winback job. Owner: Send list → inspect past-member reason, offer and 14-day validity; open the WhatsApp draft. Rejoin a test former member through normal registration.
2. Check: The job produces at most ten candidates per branch; no auto-send or automatic discount application. Staff apply the intended offer through the normal registration/discount process.
3. Readiness limit: No eligible former members means no entries. Templates work without AI; personalized wording needs AI setup. Real conversion results require a pilot. Eval: tests/agents/winback-eval.md.

**24. `pssai_next_exam` — Next exam and follow-on plan**

Status: **Setup / data**. Requires: portal; recognizable preparing-for/course text; exam ladder; suitable plan tiers; job.

1. Enable next_exam. Use a test student preparing for TNPSC Group 4 and inspect /me/next for the Group 2 next step; confirm appropriate exam notices in Growth. Run cron_next_exam for a member near expiry or after a recent exam; inspect Inbox/Send list.
2. Check: The suggestion follows the configured exam ladder, uses server plan prices and does not register/renew anyone by itself.
3. Readiness limit: Not every course maps to a supported family/ladder. No recognized course, next rung or plan can correctly produce no offer. Exam calendar can be managed manually without AI radar.

**25. `pssai_paylater_advice` — Pay-later risk advice**

Status: **Setup / data**. Requires: Student membership/payment history; scoring job; optional churn publication.

1. Enable the switch. Run cron_paylater_scores. Staff: open the registration/renewal payment area that shows Pay Later advice for a test member; compare a good renewal history with past unpaid plans.
2. Check: Low/medium/high reasons are explainable; advice suggests up to 50% or 25% for 15 days with owner OK, or full payment. Existing staff billing is not blocked solely by the score.
3. Readiness limit: Works without ML churn scores but has less information. New students have limited history. This is advice, not an automatic credit approval.

**26. `pssai_exception_desk` — AI recommendation on an approval**

Status: **AI**. Requires: A pending approval; agent function; AI key/budget.

1. Enable the switch. Student: submit a long hold/refund request. Owner: Approvals → Requests → ask for AI suggestion; compare its facts/reasons with the profile. Approve or deny separately. Try the scheduled exception_desk job.
2. Check: A suggestion/ask/deny note appears, but approval stays pending until the owner decides; no money or plan changes from the AI recommendation itself.
3. Readiness limit: Needs live-model evaluation, tests/agents/exception-desk-eval.md, and eligible requests. The recommendation is implemented; manual fulfillment remains for request types described above.

**27. `pssai_self_checkin` — QR and location self-check-in/out**

Status: **Conditional / seat issue**. Requires: portal; migration 068; HTTPS location permission; branch coordinates and poster key; PORTAL_URL as your origin.

1. Enable the switch. Owner: Branches → Self check-in → save location → make/print poster. Student: scan the poster while logged in and within 100 m → allow location → check in; check out from Home. Test outside 100 m, poor accuracy, duplicate check-in, held/expired plan and old poster after rotation.
2. Check: Only valid in-range requests create a session; checkout uses normal overtime/food rules. Stored checkin_records keep distance/accuracy, not coordinates. Staff check-in still works.
3. Readiness limit: The basic flow is implemented. Cross-branch permanent members can bypass floating-desk claiming/status updates; fix before testing cross-branch seating for real. A four-week staffed pilot remains. Portal focus rating is also missing.

**28. `pssai_session_watch` — Close forgotten sessions and flag corrections**

Status: **Setup / controlled job**. Requires: cron_close_forgotten_sessions schedule; completed migration set; anomaly switch to browse flags.

1. Enable session_watch and anomaly. On staging create one TEST active booking already past its scheduled end and another ending later. Run cron_close_forgotten_sessions; inspect Bookings, Flags and student Inbox. Separately test a staff checkout deliberately backdated by over ten minutes.
2. Check: The overdue session closes at booked end or break start with zero overtime; the later session stays active; food stays as dues. A session_auto_closed flag and notice appear, as do qualifying checkout correction flags.
3. Readiness limit: The real job runs at 23:30 IST. Manually running it acts on eligible sessions immediately across branches, so use staging for the manual test. It is not scoped to a selected test branch.

**29. `pssai_seat_matching` — Preferred/best-fit seat suggestions**

Status: **Conditional / seat issue**. Requires: Desk tags and free desks; student preferences; portal for preferences.

1. Enable the switch. Owner: Branches → tag desks (window, power, quiet, AC). Student: More → Where you like to sit → save favorites/tags. Try Suggest desk at staff check-in/Walk-in and self-check-in; occupy the favorite and retry.
2. Check: Suggestions prefer an eligible free favorite/matching desk and fall back when taken. Two floating check-ins must not claim one desk. An assigned permanent cabin keeps its own rules.
3. Readiness limit: Built; requires configured tags/preferences. Shared cross-branch permanent-member desk claiming issue affects this path, so that case is not ready for rollout.

**30. `pssai_live_seats` — Portal free-seat counts**

Status: **Ready**. Requires: portal and configured branch desks.

1. Enable the switch. Student: Home → observe branch free-seat counts. Staff: check in a temporary member, then check out; reload Home and compare the count with Dashboard. Test an unassigned walk-in and a fixed-cabin booking.
2. Check: Counts follow the backend's floating-seat capacity rules and do not expose names or seating identities.
3. Readiness limit: Implemented. Counts are read on page load/refresh; this flag alone does not provide an always-streaming seat map. The cross-branch cabin bug can skew counts until fixed.

**31. `pssai_food_orders` — Student food ordering and kitchen queue**

Status: **Hold for concurrent Food Pass rollout**. Requires: portal; checked-in member; menu items; kitchen/owner login.

1. Enable the switch on staging. Student: More → Order food → place one order. Staff: Food orders → Accept → Ready → Deliver. Repeat using Food Pass, cash/UPI, tab and a changed menu price; cancel another order.
2. Check: One order becomes one bill only on delivery. A changed price refuses delivery; a funded pass cannot also be charged cash/UPI; cancelled orders are not billed.
3. Readiness limit: Single-order flow is built and locally tested. Two different concurrent bills for the same Food Pass can overwrite one debit because balance updates are not atomic. Fix before approving concurrent real-money use. Kitchen-only screen/action restriction is also unfinished.

**32. `pssai_food_stock` — Stock use, demand and supplier drafts**

Status: **Setup / data**. Requires: Food orders UI; inventory items; menu-to-stock links and supplier phone; supplier job.

1. Enable the switch. Food orders → Stock & suppliers → link a menu item to inventory and packets per sale. Sell one item; inspect inventory_logs. Run cron_supplier_drafts; open supplier WhatsApp draft, mark sent, then receive the actual quantity.
2. Check: Sale reduces linked stock; receipt adds exactly the received quantity. A forecast uses sales history, and supplier drafts cover forecast need minus stock with safety allowance. No supplier message is sent automatically.
3. Readiness limit: No sales history means little/no useful demand forecast. Stock deduction failures are logged and do not undo a food bill, so reconcile failure cases. Food Pass concurrency remains relevant when the sale uses a pass.

**33. `pssai_tickets` — Student problem reports**

Status: **Ready**. Requires: portal; migration 069; branch staff/owner.

1. Enable the switch. Student: More → Report a problem → submit a routine test issue and an urgent test issue clearly labeled TEST. Staff: Problems → inspect order/priority, mark in progress and resolved.
2. Check: Urgent items sort first and alert the desk; the student sees own tickets and gets a resolution notice. Another student cannot see them.
3. Readiness limit: Implemented. Use clearly labeled test issues to avoid confusing staff. No external emergency dispatch or outbound messaging is implemented.

**34. `pssai_photo_tasks` — Photo required for cleaning-task completion**

Status: **Setup**. Requires: task-photos private bucket; assigned task and account; existing task-photo adoption action.

1. Enable the switch. Owner: Actions → Ask for photos on existing daily cleaning tasks, or set photo required for a test task. Assigned staff: try complete without photo, then upload an allowed image for that date and complete. Owner: open the photo.
2. Check: Completion without required photo is refused; authorized upload permits it. A missed day's completion needs that day's photo. Signed viewing URLs are short lived; scheduled retention removes old photos.
3. Readiness limit: Old tasks do not all become photo-required solely from switching on. Apply the task setting. The implemented path uploads an image file; a live in-page camera stream is not provided.

**35. `pssai_policy_learner` — Learn owner rules and apply signed hold rules**

Status: **Data / staged test**. Requires: Historical decided approvals; proposal/apply jobs; portal requests.

1. Enable the switch on staging. Supply at least six comparable actual TEST decisions with at least 90% agreement; run cron_policy_rules. Owner: Learning → Rules → sign one approve-hold proposal. Submit a matching hold request, run cron_apply_policy_rules, then retire the rule and retry with another student.
2. Check: Unsigned/deny/non-hold rules do not auto-approve. Only active signed approve-hold rules act. A second rule-approved hold for one student within 30 days waits for the owner; no T3 money action runs itself.
3. Readiness limit: Needs eligible decision history. Do not manufacture owner decisions in production to force a proposal. Live behavior remains unverified until staged real-database testing.

**36. `pssai_digital_twin` — What-if simulations**

Status: **Ready / data**. Requires: Historical renewals, checkout events and hold requests.

1. Enable the switch. Owner: Learning → What if → change renewal grace, overtime grace and self-hold limit in separate simulations. Record results and compare account/price settings before and after.
2. Check: Simulations return changed counts and estimated differences, with no actual billing, policy or membership mutation.
3. Readiness limit: Code is ready; usefulness depends on historical records. Older checkouts lacking required event facts limit retrospective simulations.

**37. `pssai_experiments` — Owner A/B experiments**

Status: **Data / controlled pilot**. Requires: A downstream feature: winback, next_exam, or food_orders; real eligible exposures/conversions.

1. Enable experiments and the selected downstream feature. Owner: Learning → Experiments → create A/B variants and start. Have two test students trigger the relevant offer/menu; revisit with each student. Run cron_experiments and inspect sample/result.
2. Check: Each student keeps the same variant. A winner needs at least 20 people per variant and p<0.1. Keep writes the winning setting; Drop changes no setting. Preview/deep links must not count as real conversions.
3. Readiness limit: Creation/exposure paths are testable now after setup; a statistically meaningful winner cannot be established with a few demo clicks. The menu test compares item ordering rates, not proof that featuring caused a lift.

**38. `pssai_space_yield` — Space-use heatmap and suggestions**

Status: **Data**. Requires: Eight-week occupancy history; correct desk capacity and waitlist records.

1. Enable the switch. Owner: Learning → Space use → select branch. Compare busy weekday/hour cells against actual bookings and inspect cabin usage/suggestions; repeat with an empty/new branch.
2. Check: Heatmap reflects the selected branch and configured seats. Suggestions are informational and do not add seats/change plans.
3. Readiness limit: Implemented. With little/no history, the screen can be tested but recommendations cannot be judged. Fix the cross-branch desk issue before using the counts for operational decisions.

**39. `pssai_portal_r4` — Exam coach, focus profile and monthly Wrapped**

Status: **Partial / data**. Requires: portal; study sessions; focus_ratings for focus analysis; supported course/exam for coach.

1. Enable portal_r4. Student: More → Exam coach, When you focus best, Your month. Use a supported course and confirmed exam, at least five ratings, and sessions in the selected month; compare against records. Try a student with no history.
2. Check: Coach reports facts/tips from current history; focus needs five ratings; Wrapped shows month hours/days/streak/desk/focus. Empty-history messaging should be honest.
3. Readiness limit: All three pages exist. Fresh student-only focus collection is incomplete because self-checkout cannot save a focus rating. Existing staff-collected ratings support testing. Coach/summary code is deterministic, not a separate generative model.

**40. `pssai_study_buddy` — Opt-in study buddy matching**

Status: **Setup / data**. Requires: Two portal students at the same branch with matching exam family and study window; job.

1. Enable the switch. Both students: More → Study buddy → opt in with the same window. Run cron_buddy_matches. Accept as one student and inspect both sides; accept as the second; try decline/opt-out with another pair.
2. Check: No identity is revealed before both accept. On mutual acceptance first name/window appear, never phone numbers. Students from mismatched branches/families/windows should not pair.
3. Readiness limit: Implemented; needs at least one compatible consenting pair. No pair is a correct result when data does not match.

**41. `pssai_retire_staff_ops` — Retire desk-staff attendance/cover/messages**

Status: **Hold for operational gate**. Requires: 30 days of unused desk operations; owner access; remaining staff assigned kitchen/housekeeping or deactivated.

1. Inspect Staff → Desk-staff screens: use in last 30 days. In staging set a test account's duty to kitchen, keep one desk-duty account and enable retirement; wait up to one minute. Verify desk login/token fails, retired actions return 410, Actions still works. Turn retirement off to check rollback.
2. Check: Attendance marking, End Session/cover board and staff messaging retire as intended; system notices/task assignment stay. Rollback allows normal sign-in again.
3. Readiness limit: Not ready to enable merely because the code exists. The 30-day usage gate is not automatically enforced by the switch. Kitchen/housekeeping duty currently does not isolate users to only their duty's screens/actions. Archival and dropping retired tables are deliberately deferred.

**42. `pssai_certificates` — Signed printable study certificates**

Status: **Setup**. Requires: portal; migration 072; stable CERTIFICATE_SECRET at least 16 characters; completed member sessions; correct PORTAL_URL.

1. Enable certificates. Student: More → Study certificates → issue for a date range with completed study → print/scan QR. Open /verify/<id> logged out, compare hours/days, then revoke and reopen the same link.
2. Check: Signed facts verify; withdrawn certificates disclose only withdrawn state. Future/overlong date ranges and more than five certificates per 30 days are refused. Auto-closed unverified sessions are excluded.
3. Readiness limit: Implemented. Without the certificate secret issuance fails; changing it later invalidates existing signatures. Live QR/public routing must be checked after the Pages deployment fix.

**43. `pssai_parent_digest` — Revocable weekly family summary**

Status: **Setup**. Requires: portal; migration 072; parent summary schedule; study history; correct PORTAL_URL.

1. Enable the switch. Student: More → Weekly summary for your family → create a link and open it logged out. Run cron_parent_digest on staging or wait until Sunday 19:00 IST. Compare daily hours/focus/end date, then replace or revoke the link.
2. Check: Summary has study figures and plan end, not payments, phone numbers or chat. Before the first snapshot an empty page is expected. Old/revoked links stop working.
3. Readiness limit: Implemented. Needs a student-created active link and a generated snapshot; running the job early freezes the current week so use staging for forced tests.

**44. `pssai_owner_overview` — All-branch owner dashboard**

Status: **Ready**. Requires: Owner/admin; configured branches and source records.

1. Enable the switch. Owner: Every branch → compare each branch's current check-ins/free seats, daily/monthly collections, dues, ending plans, approvals, problems and food orders with the corresponding screens. Try a staff account.
2. Check: Branch values and totals agree; staff is denied. Collections are gross transaction collections, not net of payouts.
3. Readiness limit: Implemented. No AI dependency. Sample data can test layout; meaningful totals need data. Fix the shared cross-branch desk issue before relying on seat totals.

**D. Run and inspect scheduled tests**

In Supabase SQL editor, first inspect installed schedules and recent executions:

~~~sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'pss_%'
ORDER BY jobname;

SELECT jobid, status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 20;
~~~

For a deliberate test of a job, use the matching helper, then inspect the HTTP response for the returned request_id in a separate query after it completes:

~~~sql
-- Example system job: records an integrity report.
SELECT public.pss_run_cron_job('cron_integrity_report') AS request_id;

-- Example AI job; uses the configured provider and can consume the AI budget.
-- Run only when you intend to test it and have enabled its feature.
-- SELECT public.pss_run_agent_job('owner_brief') AS request_id;

-- Replace the number with the request_id from the first query:
-- SELECT id, status_code, content
-- FROM net._http_response
-- WHERE id = 12345;
~~~

The helper returning a request ID is not proof of a successful function run. Expect HTTP 200 and read its content: skipped means the feature/key/budget/data prerequisite was not met. Missing helper/cron schema means setup is incomplete. A cron SQL request can succeed while the remote edge function returns an error; inspect both layers.

These jobs can affect every eligible branch, not just the branch selected in the app. Manual checkout, cleanup and rule jobs must be tested on staging data unless their real effects are intended. Some jobs deduplicate by date, so a repeat may correctly report no changes.

| Job passed to helper | Helper | Normal time in IST | Relevant switch |
|---|---|---|---|
| cron_expiry_alerts | pss_run_cron_job | Daily 06:00 | Base job; cron switch disables the old page-load loop |
| cron_purge_signups | pss_run_cron_job | Daily 00:05 | Base cleanup; cron is not its master stop |
| cron_purge_idempotency | pss_run_cron_job | Hourly at minute 17 | Base cleanup |
| cron_integrity_report | pss_run_cron_job | Daily 02:00 | Base job |
| cron_purge_images | pss_run_cron_job | Daily 03:00 | Base retention job |
| cron_resume_holds | pss_run_cron_job | Hourly at minute 25 | Existing planned holds |
| cron_session_reminders | pss_run_cron_job | Every 5 minutes | session_reminders |
| cron_waitlist_offers | pss_run_cron_job | Every 15 minutes | waitlist_offers |
| owner_brief | pss_run_agent_job | Daily 07:00 | analyst |
| collections | pss_run_agent_job | Daily 08:00 | collections |
| cron_yield_prices | pss_run_cron_job | Daily 00:05 | yield_pricing |
| cron_predict_releases | pss_run_cron_job | Hourly at minute 35 | overbooking |
| cron_score_enquiries | pss_run_cron_job | Daily 02:15 | lead_tools |
| cron_referral_conversions | pss_run_cron_job | Daily 02:30 | referral_links |
| cron_paylater_scores | pss_run_cron_job | Daily 02:45 | paylater_advice |
| cron_next_exam | pss_run_cron_job | Daily 08:10 | next_exam |
| enquiry_dedupe | pss_run_agent_job | Daily 03:30 | lead_tools |
| exam_radar | pss_run_agent_job | Daily 06:30 | exam_radar |
| winback | pss_run_agent_job | Monday 09:00 | winback |
| exception_desk | pss_run_agent_job | Every 30 minutes | exception_desk |
| cron_close_forgotten_sessions | pss_run_cron_job | Daily 23:30 | session_watch; also cancels stale food orders when food_orders is on |
| cron_supplier_drafts | pss_run_cron_job | Daily 21:00 | food_stock |
| cron_policy_rules | pss_run_cron_job | Sunday 02:20 | policy_learner |
| cron_apply_policy_rules | pss_run_cron_job | Minutes 7, 22, 37, 52 | policy_learner |
| cron_experiments | pss_run_cron_job | Monday 02:40 | experiments |
| cron_buddy_matches | pss_run_cron_job | Monday 08:30 | study_buddy |
| cron_parent_digest | pss_run_cron_job | Sunday 19:00 | parent_digest |

The schedule strings inside docs/ops/cron.sql are UTC; the times above are IST. Verify installed schedules rather than assuming they exist.

**E. ML capabilities that have no individual on/off feature flag**

Turning app_settings on does not train these models. They run from the separate ml/ Python project, export allowed Supabase fields, train locally and publish output tables. See [ml/README.md](../ml/README.md).

| Capability | Steps to test | Why results may not be ready |
|---|---|---|
| Focus Fingerprint v1 | Export data → run models → inspect cluster report → owner approves/renames labels → publish → inspect fingerprints / ask analyst about a student | Needs visit history and enough members; no dedicated staff fingerprint screen is wired in src. V2/GRU is deliberately deferred. |
| Churn score | Inspect churn report against the seven-day reminder baseline at the same contact budget; publish; inspect student_scores and Send list/analyst | Real historical validation has not been verified; no dedicated churn dashboard is wired in src. |
| Anomaly detector | Publish → enable anomaly → review Flags for two weeks | Synthetic/local behavior is not a real-data false-alarm measurement. |
| Cash-flow forecast | Publish forecasts → inspect forecasts / ask analyst about the forecast with dates | No dedicated forecast chart screen is wired; can test via tables/analyst. Historical collection/renewal data is required. |
| Engagement score/ranking | Publish → inspect student_scores model engagement and get_engagement_ranking through the owner API | Endpoint exists, but no direct frontend caller of that endpoint is present. A visible ranking screen is additional UI work if desired. |

Manual commands from the ml directory:

~~~text
uv sync
uv run pss-ml run --synthetic
uv run pss-ml export
uv run pss-ml run
uv run pss-ml run --publish
~~~

Set up ml/.env privately for the intended Supabase project before export/publish. The synthetic run does not need a database and refuses --publish. Review reports and labels before a real publish. This review did not install Python dependencies, run these models, export private data or publish scores. I7 (training a custom small language model) was explicitly skipped in the plan; it is not an unfinished promised switch.

**F. Remaining work, in priority order**

| Priority | Work | Evidence / impact |
|---|---|---|
| First | Correct Cloudflare build/output and redeploy the compiled frontend | Public HTML references /src/main.jsx and serves text/jsx. Root response also lacked the headers expected from public/_headers. Until fixed, every live browser feature is blocked. |
| First | Verify the deployed commit and Cloudflare environment | Local frontend/CLI refs now agree on confirmed backend zripsszkprhtyccukrir. Confirmed source is perfectstudyspacedev-sys/PerfectStudySpace, branch pss-ai/all-phases. This directory has no .git metadata, so matching it to a deployed commit still needs verification. |
| First | Restore shadow review and numeric controls overwritten by the blanket SQL | Otherwise enabling chat enables direct replies; numeric off strings fall back to defaults. Inspect actual DB values before changing them. |
| First | Finish same-domain signup routing / correct student-site URL | src/lib/signupLink.js plus App.JoinRoute redirect /join/<code> to the exact same URL when the configured base is this site's /join. This also blocks referral-to-signup and self-pay onboarding tests. |
| Before concurrent food use | Make Food Pass debit transactional/atomic and test two distinct bills racing for the same balance | api/domains/food.ts reads balance and writes a derived balance with only id equality. Different concurrent deliveries can lose a debit. This is an existing documented issue, confirmed in current source. |
| Before multi-branch seat pilot | Fix cross-branch permanent-member desk claiming/status | api/domains/sessions.ts decides floating claim/status from membership.category. A permanent member visiting another branch can skip free-desk claiming, link a destination desk while it stays free, and bypass its occupancy check. |
| Before WhatsApp/Other referrals | Align registration source validation with referral channels | Referral mapping/signup and migration 065 allow whatsapp/other, but create_membership and update_student_details accept only the original five sources. Automatic confirmation of these signup sources can fail; staff may have to change the source, losing attribution. |
| Before a fully self-service focus pilot | Add student-owned focus rating input and a scoped portal action | FocusPulsePrompt is only mounted in BookingsPage; record_focus_rating is staff-only. PortalFocus instructs students to rate checkout, but portal checkout has no entry point. |
| Before duty-only access rollout | Implement kitchen/housekeeping permissions if those users should see only their work | Current duty controls retirement eligibility; branch/role authorization still generally treats them as staff. The plan explicitly leaves duty-restricted screens/actions outstanding. |
| Before automated go-live | Verify migrations, functions, buckets, secrets, schedules and a real DB integration run | Management CLI access returned invalid token. Local server tests use a fake DB and cannot prove real FK embeds, indexes, races or production schema. Use tests/integration on staging, never production. |
| Tooling | Repair Windows server/integration test launchers | scripts/test-server.mjs and test-integration.mjs launch deno.cmd with spawnSync without a Windows-compatible shell/executable strategy. Direct deno.exe passed all 29 server suites; the standard command still fails, and predeploy depends on it. |
| ML / AI validation | First real ML run/publication, label approval, churn comparison and all live agent evals | Defaults/key presence are not evidence of live model accuracy. Agent runs must be checked with actual data and the evaluation files. |
| Operations | Run staged pilots and satisfy exit gates | Two weeks chat shadow mode; two weeks anomaly review; one month revenue/control and resale outcomes; four-week staffed self-check-in pilot; 30-day unused desk operations before retirement. These are measurement gates, not new missing code. |
| Manual workflows | Define who completes approved plan changes/refunds/privacy requests/waitlist allocations | Approval currently records the decision/notifies; it does not automate all fulfillment. A privacy data package and deletion workflow are not implemented by pressing Approve. |
| Optional later | Add dedicated model dashboards, archive/drop retired tables, evaluate Fingerprint v2 | Existing API/model output is usable without these screens. Table deletion is intentionally deferred until archive/retirement; custom small-model I7 is skipped, not mandatory work. |
| Documentation / performance | Update stale README/CLAUDE/deploy notes and consider staff-page splitting | README says no student login; CLAUDE says no tests/41 migrations; current code has portal/tests/72 migrations. Production build passes but staff app chunk is about 907 kB minified. |

There is no single master boolean for the owner approval queue, basic portal holds/requests, base signup form, audit log, idempotency or integrity report. They are part of the core/portal implementation. Do not look for nonexistent extra switches.

**G. Recommended test order and completion record**

1. Fix baseline deployment/project/URL settings, then smoke-test core login, students, staff check-in/out, one payment, food bill and branch access with feature switches off.
2. Test portal, focus pulse through staff checkout, owner overview, tickets, live seats and read-only learning views.
3. Test UPI/manual approvals on staging, then signup onboarding after its routing/source issues are fixed.
4. Test AI analyst, writer, proof reading, enquiry/concierge in shadow review, exception suggestions, lead tools and reminder drafts.
5. Run/publish ML and test data-dependent forecasts, anomaly/churn/engagement consumers.
6. Fix concurrency/seat issues, then test seats, cross-branch visits, self check-in, food/stock/supplier flows and automated jobs on real staging Postgres.
7. Run controlled production pilots before enabling experiments, predictive resale, signed hold rules or staff retirement for operational use.

For every row, record: feature key; commit/deploy ID; backend project; flags/dependencies; actor/branch/test record IDs; expected result; actual result; screenshots or request/response; any unexpected ledger change; pass/fail; and whether the flag was restored after testing.

Rollback means switch off that feature and reload; it does **not** undo payments, food bills, holds, automatically closed sessions, kept experiment settings, issued certificates or sent WhatsApp messages. Reconcile deliberate test effects through their normal business workflow.

**Source map**

- Entry/routing: [main.jsx](../src/main.jsx), [App.jsx](../src/App.jsx), [JoinApp.jsx](../src/JoinApp.jsx), [signupLink.js](../src/lib/signupLink.js).
- Settings: [feature helper](../supabase/functions/_shared/flags.ts), [owner feature mapping](../supabase/functions/api/domains/insights.ts), [browser flag cache](../src/hooks/useFeatureFlags.js).
- API actions/authorization/audit: [registry](../supabase/functions/api/registry.ts), [router](../supabase/functions/api/index.ts), [runAction](../supabase/functions/api/run.ts).
- Business workflows: [domain handlers](../supabase/functions/api/domains), [student portal](../src/portal), [staff pages](../src/pages).
- Money/seat gaps: [food.ts](../supabase/functions/api/domains/food.ts), [sessions.ts](../supabase/functions/api/domains/sessions.ts), [members.ts](../supabase/functions/api/domains/members.ts), [referrals.ts](../supabase/functions/api/domains/referrals.ts).
- Scheduling/deployment: [cron.sql](ops/cron.sql), [deployment notes](ops/DEPLOY.md), [Cloudflare headers](../public/_headers).
- Validation and outstanding decisions: [execution plan](plans/PSS-AI-execution-plan.md), [agent evals](../tests/agents), [integration guide](../tests/integration/README.md).
