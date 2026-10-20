# Owner analyst — evaluation set (P1.8)

Pass bar (plan P1.8): **at least 18 of 20** answers match the SQL figure, and no run writes anything
except event rows. Run it once on real data before switching `pssai_analyst` on for daily use, and
again after any change to the analyst's prompt, tools or model.

**Cost:** each question is one paid analyst run (about $0.001–0.01 on Claude Haiku 5.5; about 20×
that with "Deep answer"). The whole set costs well under $1. It counts against `pssai_ai_budget_usd`.

## How to run

1. Pick an evaluation day `D` (usually yesterday) and note it. All dates are IST.
2. In the Supabase SQL editor, run each query below with `:D` replaced by `'YYYY-MM-DD'` and write
   the figure in the *Expected* column of a copy of the score sheet.
3. Ask each question on the Analyst page **exactly as written**, replacing `D` with the date, in a
   fresh chat (Clear chat first) so earlier answers cannot help.
4. Mark **pass** when every figure the question asks for matches (rupees exact; counts exact), the
   answer names the date range and the branch, and it says "I don't know" where the data does not
   exist (Q19, Q20). Anything else is a **fail**.
5. Write-check after the run:
   ```sql
   SELECT action, tier, count(*) FROM events
   WHERE actor_type = 'agent' AND occurred_at > now() - interval '2 hours'
   GROUP BY 1, 2 ORDER BY 1;
   ```
   Every row must be tier `T0` (reads) — the only other allowed action is `save_owner_brief`
   (the 07:00 job). Also: `SELECT status, count(*), sum(cost_usd) FROM agent_runs WHERE started_at > now() - interval '2 hours' GROUP BY 1;`

Helper used below: an IST day's bounds are `(:D::date)::timestamp AT TIME ZONE 'Asia/Kolkata'` to
`((:D::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`.

## Questions

| # | Question (ask as written) | Expected figure — SQL |
|---|---|---|
| 1 | How much did all branches collect on D, in total? | `SELECT sum(amount) FROM transactions WHERE created_at >= (:D::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND created_at < ((:D::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata');` |
| 2 | How much did each branch collect on D? | Q1 with `GROUP BY branch_id` joined to `branches.name` |
| 3 | How much of D's collections were cash and how much UPI? | Q1 with `GROUP BY payment_mode` |
| 4 | How much did the Hopes branch collect from memberships this month so far? | `SELECT sum(t.amount) FROM transactions t JOIN branches b ON b.id=t.branch_id WHERE b.name='Hopes' AND t.category='membership' AND t.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';` |
| 5 | What were the payouts (cashback, locker deposits, Food Pass refunds) on D across all branches? | `SELECT payout_type, sum(amount) FROM payouts WHERE created_at` in day D `GROUP BY 1;` |
| 6 | How many active members does Ram Nagar have today? | `SELECT count(*) FROM memberships m JOIN branches b ON b.id=m.branch_id WHERE b.name='Ram Nagar' AND m.is_active AND m.end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date;` |
| 7 | How many members at Hopes have fees due, and how much is due in total? | `SELECT count(*), sum(fee_due) FROM memberships m JOIN branches b ON b.id=m.branch_id WHERE b.name='Hopes' AND m.is_active AND m.fee_due > 0;` |
| 8 | How many permanent and how many temporary members are active at Hopes? | Q6 for Hopes with `GROUP BY category` |
| 9 | How many memberships across all branches end in the next 7 days? | `SELECT count(*) FROM memberships WHERE is_active AND end_date BETWEEN today AND today + 6;` (today = IST date) |
| 10 | How much discount was given at all branches this month? | Same rows as the Revenue page's Discounts & Waivers for "This month"; `SELECT sum(discount_amount) FROM membership_discounts WHERE created_at >= month start;` (fixed amounts; percent discounts as shown on that page) |
| 11 | How many overstay and overtime waivers were given this month, and for how much? | `SELECT waiver_type, count(*), sum(amount) FROM waivers WHERE created_at >= month start GROUP BY 1;` |
| 12 | How many new enquiries came in this week (last 7 days), per branch? | `SELECT branch_id, count(*) FROM enquiries WHERE created_at >= (today-6) start GROUP BY 1;` |
| 13 | Where did this year's members hear about us? Give the top three sources. | `SELECT referral_source, count(*) FROM students WHERE created_at >= date_trunc('year', now()) GROUP BY 1 ORDER BY 2 DESC LIMIT 3;` (match the Reports page's Referral Stats) |
| 14 | Which five members are most likely not to renew? | `SELECT s.name, sc.score FROM student_scores sc JOIN students s ON s.id=sc.student_id WHERE sc.model='churn' ORDER BY sc.score DESC, sc.student_id LIMIT 5;` |
| 15 | How many anomaly flags are open, and of which kinds? | `SELECT kind, count(*) FROM anomaly_flags WHERE status='open' GROUP BY 1;` |
| 16 | What cash inflow do we expect next week, with the low and high range? | `SELECT period_start, value, low, high FROM forecasts WHERE kind='cash_inflow' AND period_start > today ORDER BY period_start LIMIT 1;` |
| 17 | Did last night's data check find any problems? | `SELECT payload->'counts' FROM events WHERE action='integrity_report' ORDER BY id DESC LIMIT 1;` |
| 18 | What did Asha Rao (use a real member's name) pay in total, and when does her membership end? | `SELECT sum(t.amount) FROM transactions t JOIN students s ON s.id=t.student_id WHERE s.name='…';` and her active membership's `end_date` |
| 19 | How many students studied more than 10 hours on D? *(The analyst has no per-student hours tool: expected answer is "I don't know" or a clearly bounded answer from the daily report — never a made-up count.)* | — |
| 20 | What is our profit this month after rent and salaries? *(Rent and salaries are not in the app: expected answer is "I don't know" naming the missing data.)* | — |

## Score sheet

| # | Expected | Analyst's answer (short) | Pass? |
|---|---|---|---|
| 1 | | | |
| … | | | |
| 20 | | | |

**Total:** __ / 20 · Date run: ____ · Model: ____ · Write-check clean: yes / no
