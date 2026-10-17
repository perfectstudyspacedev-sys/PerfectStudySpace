# ml/ — PSS-AI Phase 1 behaviour models

Runs on your own computer (plan decision S11), never in the app. It reads an export of the Supabase
tables, trains the models and writes their results back to the tables from migration `056`. The app
only shows those results, to owner and admin. **Nothing here changes money or acts by itself.**

| Plan item | Module | Writes |
|---|---|---|
| P1.2 export and features | `pss_ml/export.py`, `features.py` | `ml/data/*.parquet` (gitignored) |
| P1.4 Focus Fingerprint v1 | `fingerprint.py` | `fingerprints` + `ml/reports/clusters-<date>.md` |
| P1.5 churn model | `churn.py` | `student_scores` (model `churn`) + `ml/reports/churn-<date>.md` |
| P1.6 anomaly detector | `anomaly.py` | `anomaly_flags` (the owner's Flags page) |
| P1.7 forecast + engagement | `forecast.py` | `forecasts`, `student_scores` (model `engagement`) |

Only ids, dates, amounts, statuses and staff display names are exported — never student names,
phone numbers, photos or Aadhaar data (`pss_ml/data.py`, checked by the tests).

## One-time setup

1. Install [uv](https://docs.astral.sh/uv/), then from this folder: `uv sync`
2. Copy `env.example` to `.env` here and fill in `SUPABASE_URL` and the **service-role** key
   (Supabase → Project Settings → API). `.env` is gitignored; never commit or share it.
3. Migrations `055` and `056` must be applied first.

## Every week

```bash
uv run pss-ml export                 # download the tables to ml/data/
uv run pss-ml run                    # train and score; rows go to ml/out/latest/ only
# read ml/reports/churn-<date>.md and clusters-<date>.md, then:
uv run pss-ml run --publish          # write the results to Supabase
```

- `--budget 20` sets the weekly contacts per branch used in the churn comparison (default 20).
- `--labels labels.json` renames clusters, e.g. `{"C2 · high focus, comes most days": "Steady regulars"}`.
  The owner approves the cluster labels before they are shown anywhere (P1.4 gate).
- Re-publishing is safe: this run's scores, fingerprints and forecast are written first, then the
  rows of earlier runs are removed (so a member who has left loses their old score, and a failed
  write leaves the previous run in place). Flags already published — and maybe already reviewed —
  are left exactly as they are.
- The Flags page appears once `pssai_anomaly` is `on` in `app_settings`.

## Try it without any data

```bash
uv run pss-ml run --synthetic --budget 8    # a made-up hall with planted signals → ml/out/synthetic/
uv run pytest -q && uv run ruff check .     # 25 tests on the same synthetic data
```

## What the models do

- **Churn (P1.5).** Label: no new membership starting within 10 days after the end date. Trained 7,
  14, 21 and 28 days before the end (days-to-end is a feature; holds and payments count only up to
  that day). A Cox model and gradient boosting are compared on the most recent ~2.5 months, with a
  10-day gap after the training period; the better one is kept. The report compares it with today's
  "remind everyone expiring in the next 7 days" at the weekly budget, contacting nobody twice. Only
  members whose plan ends in the next 28 days get a score. Reasons: `attendance_drop`, `dues`,
  `short_tenure`, `holds`, `late_payer`, `other`.
- **Fingerprint (P1.4).** Last 60 days of habits (arrival time and spread, minutes, use of booked
  hours, visit days, weekends, food, focus) → scaled → PCA (3) → k-means (3–6 by silhouette).
- **Anomalies (P1.6).** Each discount, fixed cashback, waiver, manual attendance entry (hours from
  its start and end time) and overtime exclusion against the same staff member's and the branch's
  medians — all records of the kind only when both are too short (robust z-score). Only the last 14
  days can be flagged (baselines use all history); at most 5 a week (IST weeks), score 3.5 or more.
  The hidden admin account's records are left out. Explanations are fixed templates.
- **Forecast (P1.7).** Per active membership: renewal amount × (1 − churn score) in the week after
  it ends (members already in their grace period: this week, 50% unless scored); plus open dues ×
  the dues collection rate (of what was still owed after a membership's first payment day, the share
  paid later, over memberships that ended 30–180 days ago); plus the recent weekly average of all
  other income. 90% band.
- **Engagement (P1.7).** 0–1 from use of booked hours, visit days, focus and (1 − churn score).
