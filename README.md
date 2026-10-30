# Perfect Study Space

Source: [PerfectStudySpace — pss-ai/all-phases](https://github.com/perfectstudyspacedev-sys/PerfectStudySpace/tree/pss-ai/all-phases).
Backend project: `zripsszkprhtyccukrir`. Cloudflare Pages project: `perfectstudyspace`.
Manual backend/frontend deployment and live checks: [release guide](docs/ops/MANUAL-RELEASE-2026-10-30.md).

AI additions support **Ollama Cloud → Gemini → Claude**. Provider setup, supported capabilities,
model overrides and rollout steps: [AI provider guide](docs/ops/AI-PROVIDERS.md).

Multi-branch reading hall / study desk rental management app with an owner/staff dashboard and an optional student portal.

Built with the same stack and black-and-yellow UI theme as [Cue Court Coffee](../CUE-COURT-COFFEE).

## Tech Stack

- **Frontend:** React 19 + Vite 6
- **Backend:** Supabase Postgres + Edge Functions
- **Auth:** Custom JWT staff login (owner / staff roles)
- **Storage:** Supabase Storage (`student-photos` bucket for Aadhaar & member photos)

## Features

- **3-branch management** with owner branch switcher; staff locked to one branch
- **Interactive seat map** — free (yellow) / occupied / reserved (permanent members)
- **Walk-in** hourly bookings with auto desk assignment
- **Membership** — temporary (floating) or permanent (fixed cabin), multi-month discounts, locker add-on
- **Spreadsheet-style student table** — S.No, Name, Cabin, Due Date, Month, Hours, Timings, Locker, Locker Due, Course, Contact — sortable, filterable, overdue highlighting, CSV export
- **Enquiries pipeline** — new/contacted/converted/dropped funnel, duplicate detection & merge, notes, activity timeline, follow-up tasks, bulk actions, saved filter chips, CSV export, WhatsApp/email quick actions
- **Food billing** with separate revenue tracking
- **Revenue & reporting** — category breakdown (desk / membership / food / locker), payment mode charts, transactions list
- **Daily reports** & actionable items export
- **In-app messaging** & expiry/payment alerts
- **Staff management** (owner only)

## Setup

### 1. Supabase Project

1. Create a new Supabase project
2. Run the migration: `supabase/migrations/001_initial.sql`
3. Create a **public** storage bucket named `student-photos`
4. Deploy the Edge Function:

```bash
supabase functions deploy api
```

5. Set Edge Function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STAFF_JWT_SECRET` (random string)

### 2. Frontend

```bash
cd perfect-study-space
cp .env.example .env
# Edit .env with your Supabase URL and anon key
npm install
npm run dev
```

### 3. First login

Set strong passwords for the seeded accounts at first deploy.

## Project Structure

```
src/
  pages/          Dashboard, Walk-in, Membership, Students, Food, Revenue, Reports, Messages
  components/     Shell layout with nav + branch switcher
  context/        AuthContext (JWT session)
  lib/            api.js, utils.js
  styles/         theme.css (CCC black & gold design tokens)
supabase/
  migrations/     Postgres schema
  functions/api/  Monolithic Edge Function (action dispatch)
```

## Role Access

| Feature           | Owner | Staff |
|-------------------|-------|-------|
| All branches      | ✅    | ❌ (own branch only) |
| Seat map / bookings | ✅  | ✅    |
| Students / food   | ✅    | ✅    |
| Revenue           | ✅ (all branches) | ✅ (own branch) |
| Branch/desk config | ✅   | ❌    |
| Staff management  | ✅    | ❌    |

Revenue is enforced at the Edge Function level — not just hidden in the UI.

## Reference

Architecture and UI patterns adapted from:
`D:\CUE-COURT-COFFEE\CCC-Final-Changes-6\cue-court-coffee_retest1`
