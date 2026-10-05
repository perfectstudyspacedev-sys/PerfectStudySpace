# RSP — Renew & Settle Plan (Phase 1) + SSP — Self Sign-up Plan (Phase 2)

| | |
|---|---|
| **Status** | ✅ Built and tested on the branch (RSP + SSP). Not yet deployed — follow the deploy order at the end. |
| **Agreed on** | 2026-10-04 |
| **Execution order** | **Phase 1: RSP** first → **Phase 2: SSP** after RSP is finished and verified |
| **Branch it was planned on** | `claude/loving-davinci-o5y9jm` |

## How to use this file in a future chat

- Say **"Build RSP"**, **"Build SSP"**, or **"Build the plan"** (= RSP then SSP).
- Refer to items by label, e.g. *"In RSP change R2"*, *"skip W1"*, *"add a new item to SSP Part 4"*.
- Anyone implementing this must read the whole file first: the **Decisions** tables record what the
  owner chose and must not be re-decided.
- When an item is done, mark it ✅ in this file in the same commit as the code.

## Labels at a glance

| Phase | Part | Labels |
|---|---|---|
| RSP | Renewal | **R1–R7** |
| RSP | Overstay charge | **O1–O4** |
| RSP | Delete refund | **D1–D3** |
| RSP | Money & records | **M1–M3** |
| RSP | Waivers tracking | **W1–W2** |
| RSP | Database | **DB-RSP** |
| SSP | Student page | **S1–S3** |
| SSP | Alerts | **N1–N2** |
| SSP | Staff actions | **A1–A4** |
| SSP | Simultaneous use | **C1–C4** |
| SSP | Safety | **X1–X3** |
| SSP | Database | **DB-SSP** |

## Before starting (prerequisite from earlier work)

The revenue/ledger fixes already pushed on this branch (commits `a7f0b95`, `0a05eda`, `718a7d7`,
`a59bc88`) require migration **`049_transaction_category_overtime.sql`** to be applied **before** the
edge function is deployed. Make sure that is done first.

---

# PHASE 1 — RSP: Renew & Settle Plan

Example used throughout: a ₹1,250/month plan that **ends 15 Oct**.

## RSP — Decisions (made by the owner, do not re-decide)

| # | Question | Decision |
|---|---|---|
| 1 | Allow renewing before expiry? | **Yes — "early renewal"**, new period starts the day after the current one ends |
| 2 | Wallet / advance-credit instead? | **No** (early renewal chosen as more user-friendly) |
| 3 | Button naming | **One "Renew" button everywhere**; the type is detected automatically |
| 4 | Plan change when renewing early | **Not allowed** — same plan; use Change Plan after the new period starts |
| 5 | How early can staff renew | **Any time** while the membership is active |
| 6 | Cancel Early Renewal refund | **Full renewal money** refunded |
| 7 | Renewal during the 10-day grace | **Grace days always count as used**, even if the student did not come → start = day after expiry |
| 8 | Overstay charge on Quit/Delete | **Up to the last member check-in after expiry** (auto-capped at 10 days because check-in is blocked after grace) |
| 9 | Delete refund for discounted multi-month plans | **Option 2 — refund unused days at the discounted rate** |
| 10 | Waivers | **Add W1 and W2**; W3 (owner-only limits) **not** chosen |

## RSP — Problems found in the current app (why this plan exists)

1. The Renew button appears 7 days before expiry but **fails before the expiry date** ("Start date
   cannot be in the future"), even on the expiry day itself. The only workaround (start = today) makes
   the student **lose their remaining days**.
2. The student profile only shows Renew **after** expiry and has no start-date field.
3. Renewing while the membership is **on hold** leaves the hold open forever on the old membership.
4. The Quit/Delete **overstay charge counts every day since expiry**, including days after the 10-day
   grace when check-in is blocked (e.g. quitting 25 days late charges 25 days ≈ ₹1,042).
5. The Delete refund uses the **undiscounted** rate, so a discounted multi-month plan can refund more
   per day than the student paid (3 months ₹3,375 paid, delete after 30 days → ₹2,500 refund today).
6. The app does not store a membership's actual plan price or plan days (custom-day plans and
   renewals with cashback/overtime cannot be reconstructed later).
7. Overstay waive and overtime omit leave **no record** of who/why/how much; the owner cannot see the
   total discounted or waived anywhere.

## Part 1 — Renewal

✅ **R1. Where the button is**
- Members tab: last 7 days + expired (as now).
- Student profile → Membership Control: **any time the membership is active** (today: only after expiry).

✅ **R2. Type detected automatically by the server** (the form only displays it)

| Renewing on | Type | New period starts | Plan change |
|---|---|---|---|
| Up to and including 15 Oct | **Early** | 16 Oct (fixed) | ❌ same plan |
| 16–25 Oct (10-day grace) | **Grace** | 16 Oct (fixed — grace days count as used) | ✅ |
| 26 Oct or later | **Late** | Today (staff may backdate, never before 16 Oct) | ✅ |

The form shows a banner such as *"Early renewal — starts 16 Oct, same plan"*.

✅ **R3. Early renewal rules** — start fixed; same category and hours (custom plans: same weekday/weekend
hours); duration (1/2/3/6 months or custom days) and payment (Full / Partial / Pay Later) as now;
cashback and unbilled overtime applied as now.

✅ **R4. Renewal blocked with a clear message (all types)**
- Unpaid dues on the current membership → "Clear ₹X first" (existing).
- **On hold → "Resume first"** (new).
- Already renewed early → no second renewal until the new period starts (new).
- Double-click / two devices → existing claim guard.

✅ **R5. Between an early renewal and its start date ("the gap")**
- Check-in, food, overtime, holds work normally (a hold extends the new end date).
- **Delete, Change Plan and Quit are blocked** → "Cancel the early renewal first".

✅ **R6. Cancel Early Renewal** (only until the start date; reason required, logged like deletions)
- Re-activates the previous membership with its end date (+ any hold days taken in the gap).
- Refunds the renewal money in full (sum of the new membership's `membership`-category transactions)
  as a `membership_refund` payout. Overtime that was settled at renewal stays settled.
- Cashbacks redeemed by that renewal → back to `pending`.
- Bookings / overtime sessions recorded in the gap → re-pointed to the previous membership.
- Blocked if currently on hold ("Resume first") or if the student was transferred to another branch
  after renewing early.

✅ **R7. Labels** — Members list: **"Renewed early · starts 16 Oct"** and the Renew button hidden.
Profile: shows the new period + **Cancel Early Renewal** button.

## Part 2 — Overstay charge (Quit, and Delete after expiry)

- ✅ **O1.** Overstay = days from the day after expiry **up to the last member check-in after expiry**;
  ₹0 if they never came.
- ✅ **O2.** Automatically capped at 10 days (check-in is blocked after grace). Walk-in visits do not count.
- ✅ **O3.** Daily rate = **monthly fee ÷ 30** (same as today for normal plans; correct for custom-day plans).
- ✅ **O4.** The bill shows the working, e.g. *"Last visit 22 Oct → 7 days × ₹41.67 = ₹292"*. The waive
  tickbox stays and now **requires a reason** (W2a).

> By design: a renewal in grace counts all grace days as used; Quit/Delete only charge up to the last visit.

## Part 3 — Delete refund (unused days)

- ✅ **D1.** Refund = unused days × **(plan price after multi-month discount ÷ plan days)**, never more
  than what was actually paid. Example: 3 months ₹3,750 → ₹3,375 after 10% → delete after 30 days →
  60 × ₹37.50 = **₹2,250** (was ₹2,500).
- ✅ **D2.** Plan price and plan days are stored at purchase (DB-RSP) so custom-day plans refund exactly.
  Memberships created before this change use the best estimate:
  `monthly_fee × months_paid × (1 − discount_percent/100)` over `membershipTotalDays()`.
- ✅ **D3.** Unused days count from today — or from the start date if the period has not started yet.

## Part 4 — Money & records

- **M1.** Renewal money recorded once, on the day it is paid; note e.g. *"Renewal (early — starts 16 Oct)"*.
- **M2.** Cancel Early Renewal = a separate refund (payout) entry; ledger rows are never deleted.
- **M3.** Everything flows into the Revenue page (uses the existing `recordTransaction` / `recordPayout`
  / `insertPaymentTransactions` helpers).

## Part 5 — Waivers tracking

✅ **W1. "Discounts & Waivers" section on the Revenue page** (follows the selected dates/branch)

| Line | Source |
|---|---|
| Loyalty discounts | `membership_discounts.discount_amount` (+ applied_by) |
| Cashback used on renewals | `cashbacks.redeemed_amount` where status `redeemed` (paid-out cashback already shows under Payouts) |
| Food bill discounts | `food_bills.discount_amount` (+ created_by) |
| Overstay waived | new `waivers` log (W2a) |
| Overtime omitted | new `waivers` log (W2b) |
| Multi-month discounts (automatic) | memberships created in range: `monthly_fee × months_paid × discount_percent/100` |

Shows a total per line and a list (date, student, type, amount, who, reason).

✅ **W2. Who / how much / why**
- **W2a.** Overstay waive (Quit & Delete): reason **required**; amount, staff, time, reason saved.
- **W2b.** Overtime omit (profile Overtime History): reason **required**; un-omit is also recorded.
- Stored in the new append-only `waivers` table (never edited or deleted).

## DB-RSP — Migration `050` (additions only) ✅ written (`050_renewals_and_waivers.sql`)

- `memberships.renewed_from_membership_id uuid null references memberships(id) on delete set null`
- `memberships.plan_amount numeric(10,2) null` — price after multi-month discount, before cashback/overtime
- `memberships.plan_days int null` — days the plan covers at purchase (custom days or date span)
- New table `waivers` (`id`, `branch_id`, `student_id`, `membership_id`, `waiver_type` in
  `overstay` / `overtime_omit` / `overtime_restore`, `amount`, `reason` not null, `related_id`,
  `created_by_staff_id`, `created_at`). RLS enabled with no policies, like every other table
  (access only through the edge function's service-role client).

## RSP — Where the code lives (for the implementer)

| Area | Location |
|---|---|
| Renewal | `renew_membership` in `supabase/functions/api/index.ts` (default start date, "Start date cannot be in the future", claim of old membership) |
| Members-tab renew form | `src/pages/MembershipPage.jsx` (`defaultRenewStartDate`, renew modal, start-date input `max={todayISO()}`) |
| Profile renew | `src/pages/StudentProfilePage.jsx` (`openRenew`, Membership Control shows Renew only when `isExpired`) |
| Quit | `get_membership_closure_summary`, `close_membership` |
| Delete | `computeDeleteSettlement`, `get_membership_delete_summary`, `delete_membership` |
| Change Plan | `change_membership_plan` |
| Hold | `pause_membership` / `resume_membership` |
| Overtime omit | `set_overtime_excluded` |
| Check-in grace | `check_in_member` (`MEMBERSHIP_GRACE_DAYS = 10`) |
| Revenue page | `src/pages/RevenuePage.jsx`, `get_revenue` |

Important invariant: the app assumes **one active membership per student** (many `.eq("is_active", true).maybeSingle()`
queries). Early renewal keeps this: renewal already switches the old membership off and makes the new one
the only active row; check-in looks only at `end_date`, not `start_date`.

## RSP — Testing (must pass before hand-over)

- ✅ **T1.** Tests on the real server code: all 3 renewal types and every block; Cancel (refund, restore,
  cashback back to pending, re-pointed bookings); overstay (no visits / visits / after day 10 / walk-in
  ignored); refund (normal, discounted, custom days, legacy rows); waivers logged.
- ✅ **T2.** Browser checks: type banner and fixed dates on both forms; label; button show/hide; Cancel flow;
  W1 section; reason prompts.
- ✅ **T3.** Re-run the existing Revenue (28) and renewal (8) browser checks, `npm run build`, and the edge
  function type-check (no new errors vs. baseline).

## RSP — Not changing

Walk-ins, lockers, Food Pass, the rest of the Revenue page, Quit only for expired memberships (Delete
before expiry), late renewals still start today by default, who may apply discounts (W3 not chosen).

---

# PHASE 2 — SSP: Self Sign-up Plan

Goal: staff no longer type a new student's personal details. Each branch has its own unlisted link;
the student fills their own details; staff approve and finish the registration.

## SSP — Decisions (made by the owner, do not re-decide)

| # | Question | Decision |
|---|---|---|
| 1 | Fields the student fills | **Only the existing ones**: name, phone, emergency contact, course, how they heard about us |
| 2 | Pending sign-up expiry | **End of the day** (IST), then deleted automatically |
| 3 | Google Form in the welcome WhatsApp | **Leave it untouched** |
| 4 | QR code per branch | **No** |
| 5 | Approve flow | **Approve opens New Registration pre-filled**; staff add plan/payment and register |

## SSP — Staff workflow (what staff do)

1. Student opens the branch link, fills the 5 fields, taps **Submit** → sees *"Thanks Ravi! Please show
   this to the desk — Ref #7F3A"*.
2. Popup (≈30 s) on that branch's staff devices + owner: *"New sign-up: Ravi Kumar (…1234) · Ref #7F3A"*.
   Membership tab shows a "N pending" badge; **Pending sign-ups** list in New Registration (oldest first).
3. Staff click **Approve** → New Registration opens with the 5 details pre-filled ("From self sign-up #7F3A").
4. Staff verify/fix details, choose plan, duration, cabin, locker, payment → **Register** (as today,
   welcome WhatsApp + Google Form unchanged). The sign-up disappears from the list.
5. **Deny** → deleted immediately. Not handled by end of day → deleted automatically. Form closed
   without registering → back to pending.

## Part 1 — Student page

- ✅ **S1.** Separate page reachable only by link, one per branch, using a **secret code** in the link
  (not the branch name). Not linked from anywhere in the app. Route outside the login (e.g. `/join/:code`).
- ✅ **S2.** Fields: name, phone, emergency contact, course, how they heard (same checks as the app:
  10-digit phone, emergency contact ≠ own phone, source from the existing list).
- ✅ **S3.** On success shows the Ref code. The page can only **submit** — it can never read or change data.

## Part 2 — Alerts

- ✅ **N1.** Popup to the branch's staff and the owner via the existing message-alert system
  (`useMessageAlerts`, tagged message like the existing `[new_enquiry]`).
- ✅ **N2.** "Pending" badge on the Membership tab + Pending sign-ups list in New Registration.

## Part 3 — Staff actions

- ✅ **A1.** Approve → New Registration pre-filled; staff finish and register.
- ✅ **A2.** Deny → deleted immediately.
- ✅ **A3.** Pending sign-ups older than end of day (IST) → deleted automatically (lazy purge on list/submit).
- ✅ **A4.** Staff see their branch; owner sees all branches.

## Part 4 — Simultaneous use

- ✅ **C1.** Each sign-up is a separate entry with its own Ref code; popups stack.
- ✅ **C2.** Lock while someone handles it ("Being handled by Priya"); released on close or after 15 minutes.
- ✅ **C3.** Server allows only one Register/Deny to succeed ("Already handled by someone else").
- ✅ **C4.** One pending sign-up per phone per branch; a resubmission updates it (unless staff are handling
  it → "The desk is processing your details"). Phone with an active membership → flagged "use Renew",
  Approve disabled; the student only sees "Please speak to the desk".

## Part 5 — Safety

- ✅ **X1.** Submit-only public access; limit on pending sign-ups per branch; field length limits; hidden
  anti-bot field.
- ✅ **X2.** Nothing enters `students` / `memberships` until staff press Register; denied and expired
  sign-ups are fully deleted.
- ✅ **X3.** Branch Settings: **"Copy link"** and **"Make new link"** (in case a link leaks). No QR code.

## DB-SSP — Migration `051` (additions only) ✅ written (`051_self_signup.sql`)

- `branches.signup_code text unique null` — the secret code in each branch's link.
- New table `signup_requests` (`id`, `branch_id`, `ref_code`, `name`, `phone`, `emergency_contact`,
  `course`, `referral_source`, `claimed_by_staff_id`, `claimed_at`, `created_at`), at most one pending row
  per (`branch_id`, `phone`). RLS enabled, no policies.

## SSP — Build notes (as implemented)

- C4: the student's reply is the same whether or not the phone is already a member ("Please show this
  to the desk — Ref #…"), so the public page can't be used to check who is a member; staff see the flag.
- X3: staff can also **copy** the branch link from New Registration (only the owner/admin can create it
  or make a new one).
- Pending list: owner/admin see every branch's sign-ups; Approve works only in the branch it was sent to.

## SSP — Where the code lives (for the implementer)

| Area | Location |
|---|---|
| Public endpoints | `supabase/functions/api/index.ts`, next to `public_create_enquiry` (before `authStaff`) |
| Registration | `create_membership` (accepts the sign-up id and consumes it atomically after success) |
| Routes | `src/App.jsx` (public route outside `ProtectedRoute`) |
| New Registration form | `src/pages/MembershipPage.jsx` (pre-fill + Pending sign-ups list) |
| Popups / badge | `src/hooks/useMessageAlerts.js`, `src/components/layout/Shell.jsx` |
| Link management | `src/pages/BranchSettingsPage.jsx` |

## SSP — Testing (must pass before hand-over)

- ✅ Server tests: submit, duplicate phone (update), active member flagged, lock, two staff at once,
  Deny, end-of-day expiry, spam limit, invalid/rotated link.
- ✅ Browser checks: student page at phone width, popup, badge, pre-filled form, "being handled" state.

## SSP — Not changing

Google Form and welcome message, New Registration rules/checks, walk-in registration.

---

# Deploy order (after both phases are built)

1. Migration `049` (if not already applied).
2. Migration `050` (RSP).
3. Migration `051` (SSP).
4. `supabase functions deploy api`.
5. Frontend (Vercel).

---

# HSL — Hide Staff Link (follow-up to SSP) ✅ built

Students' sign-up links use `https://join.perfectstudyspace.in/<code>`, never the staff site's address.

- ✅ **L1.** Same Cloudflare Pages project (`perfect-study-space`). Opened on a `join.` address, the app
  shows only the sign-up form; the login page and staff screens are never downloaded there.
- ✅ **L2.** Short links: `join.perfectstudyspace.in/<code>`. Any other path there → "link no longer valid".
- ✅ **L3.** Copy link buttons use `VITE_SIGNUP_SITE_URL` (Cloudflare variable on `perfect-study-space`);
  without it (local testing) they keep `<this site>/join/<code>`.
- ✅ **L4.** Old `<staff address>/join/<code>` links forward to the sign-up address.
- ✅ **L5.** `public/_headers`: the security headers from `vercel.json`, which Cloudflare Pages doesn't read.

Setup (owner, Cloudflare): add custom domain `join.perfectstudyspace.in` to `perfect-study-space`, add the
variable `VITE_SIGNUP_SITE_URL=https://join.perfectstudyspace.in`, redeploy.
