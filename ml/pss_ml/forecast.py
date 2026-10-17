"""P1.7 — cash-flow forecast (I31) and engagement score.

Forecast: for each active membership, its renewal amount × (1 − churn score) on the day after it
ends, plus open dues × the collection rate seen in the last 180 days, plus the recent weekly average
of everything else (walk-ins, food, lockers, overtime). Weekly rows for FORECAST_DAYS with a
low/high band (90%).

Engagement: 0–1 per active member from recent use of booked hours, visit days, focus and
(1 − churn score).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import FORECAST_DAYS, MODEL_VERSION
from .data import Dataset
from .features import ist_day
from .fingerprint import active_students, habits

Z90 = 1.645


def forecast(ds: Dataset, churn: pd.DataFrame | None = None) -> pd.DataFrame:
    today = ist_day(pd.Series([ds.as_of]))[0]
    risk = {} if churn is None or churn.empty else dict(zip(churn["student_id"], churn["score"], strict=True))
    m = ds["memberships"]
    active = m[m["is_active"].fillna(False).astype(bool) & (m["end_date"] >= today)]
    weeks = pd.date_range(today, today + pd.Timedelta(days=FORECAST_DAYS - 1), freq="7D")
    mean = np.zeros(len(weeks))
    var = np.zeros(len(weeks))

    def week_of(day: pd.Timestamp) -> int | None:
        i = int((day - today).days // 7)
        return i if 0 <= i < len(weeks) else None

    for row in active.itertuples():
        i = week_of(row.end_date + pd.Timedelta(days=1))
        if i is None:
            continue
        amount = float(row.plan_amount) if pd.notna(row.plan_amount) else float(row.monthly_fee or 0) * float(row.months_paid or 1)
        p = 1 - float(risk.get(row.student_id, 0.3))
        mean[i] += amount * p
        var[i] += amount * amount * p * (1 - p)

    # Dues: what share of membership dues was collected recently, spread over the next two weeks.
    tx = ds["transactions"]
    recent_mem = m[(m["end_date"] >= today - pd.Timedelta(days=180)) & (m["end_date"] < today)]
    billed = (recent_mem["plan_amount"].fillna(recent_mem["monthly_fee"] * recent_mem["months_paid"])).sum()
    collected = tx[tx["membership_id"].isin(recent_mem["id"]) & (tx["category"] == "membership")]["amount"].sum()
    rate = float(np.clip(collected / billed, 0, 1)) if billed else 0.8
    dues = float(active["fee_due"].fillna(0).clip(lower=0).sum())
    for i in range(min(2, len(weeks))):
        mean[i] += dues * rate / 2
        var[i] += (dues / 2) ** 2 * rate * (1 - rate)

    # Everything that is not a membership payment: recent weekly average and spread.
    other = tx[tx["category"] != "membership"].copy()
    other["day"] = ist_day(other["created_at"])
    other = other[(today - other["day"]).dt.days.between(1, 56)]
    weekly = other.groupby(((today - other["day"]).dt.days - 1) // 7)["amount"].sum().reindex(range(8), fill_value=0)
    mean += float(weekly.mean())
    var += float(weekly.var(ddof=1)) if len(weekly) > 1 else 0.0

    sd = np.sqrt(var)
    return pd.DataFrame(
        {
            "kind": "cash_inflow",
            "period_start": [w.date() for w in weeks],
            "value": np.round(mean, 0),
            "low": np.round(np.clip(mean - Z90 * sd, 0, None), 0),
            "high": np.round(mean + Z90 * sd, 0),
        }
    )


def engagement(ds: Dataset, churn: pd.DataFrame | None = None, days: pd.DataFrame | None = None) -> pd.DataFrame:
    h = habits(ds, days)
    active = sorted(active_students(ds))
    h = h.reindex(active)
    risk = pd.Series(
        {} if churn is None or churn.empty else dict(zip(churn["student_id"], churn["score"], strict=True)), dtype=float
    ).reindex(active)
    parts = pd.DataFrame(
        {
            "use": h["usage_mean"].clip(0, 1).fillna(0),
            "visits": (h["visit_days_per_week"] / 6).clip(0, 1).fillna(0),
            "focus": ((h["focus_mean"] - 1) / 4).fillna(0.5),
            "stay": (1 - risk).fillna(0.7),
        },
        index=active,
    )
    score = (0.3 * parts["use"] + 0.3 * parts["visits"] + 0.15 * parts["focus"] + 0.25 * parts["stay"]).round(4)
    weakest = parts.idxmin(axis=1).map({"use": "leaves early", "visits": "few visits", "focus": "low focus", "stay": "renewal risk"})
    return pd.DataFrame(
        {
            "student_id": active,
            "score": score.to_numpy(),
            "reason": np.where(score.to_numpy() < 0.5, weakest.to_numpy(), None),
            "version": MODEL_VERSION,
        }
    )
