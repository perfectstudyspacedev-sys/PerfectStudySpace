"""P1.2 — features shared by the models.

student_days: one row per student per IST day they studied.
membership_frame: one row per membership, with its renewal outcome and history.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import GRACE_DAYS, IST_OFFSET_HOURS
from .data import Dataset

IST = pd.Timedelta(hours=IST_OFFSET_HOURS)


def ist_day(ts: pd.Series) -> pd.Series:
    return (ts + IST).dt.tz_localize(None).dt.normalize()


def student_days(ds: Dataset) -> pd.DataFrame:
    """Arrival minute (IST), minutes used against scheduled, sessions, weekend, food, focus."""
    b = ds["bookings"]
    b = b[(b["booking_type"] != "walkin") & b["student_id"].notna() & b["start_time"].notna()].copy()
    if b.empty:
        return pd.DataFrame(
            columns=[
                "student_id",
                "day",
                "arrival_minute",
                "minutes_used",
                "scheduled_minutes",
                "usage_ratio",
                "sessions",
                "weekend",
                "food_spend",
                "focus",
            ]
        )
    b["day"] = ist_day(b["start_time"])
    local = b["start_time"] + IST
    b["arrival_minute"] = local.dt.hour * 60 + local.dt.minute
    end = b["end_time"].where(b["end_time"].notna(), b["start_time"] + pd.to_timedelta(b["hours"].fillna(0), unit="h"))
    used = (end - b["start_time"]).dt.total_seconds() / 60 - b["total_pause_minutes"].fillna(0)
    b["minutes_used"] = used.clip(lower=0)
    b["scheduled_minutes"] = b["scheduled_hours"].fillna(b["hours"]).fillna(0) * 60
    days = (
        b.groupby(["student_id", "day"])
        .agg(
            arrival_minute=("arrival_minute", "min"),
            minutes_used=("minutes_used", "sum"),
            scheduled_minutes=("scheduled_minutes", "sum"),
            sessions=("id", "count"),
        )
        .reset_index()
    )
    days["usage_ratio"] = np.where(days["scheduled_minutes"] > 0, days["minutes_used"] / days["scheduled_minutes"], np.nan)
    days["weekend"] = days["day"].dt.dayofweek >= 5

    food = ds["food_bills"].dropna(subset=["student_id"]).copy()
    if not food.empty:
        food["day"] = ist_day(food["created_at"])
        food = food.groupby(["student_id", "day"])["total"].sum().rename("food_spend").reset_index()
        days = days.merge(food, on=["student_id", "day"], how="left")
    else:
        days["food_spend"] = 0.0
    days["food_spend"] = days["food_spend"].fillna(0.0)

    ratings = ds["focus_ratings"].merge(b[["id", "day"]], left_on="booking_id", right_on="id", how="inner")
    if not ratings.empty:
        focus = ratings.groupby(["student_id", "day"])["rating"].mean().rename("focus").reset_index()
        days = days.merge(focus, on=["student_id", "day"], how="left")
    else:
        days["focus"] = np.nan
    return days.sort_values(["student_id", "day"]).reset_index(drop=True)


def renewal_kind(prev_end: pd.Timestamp, renewed_on: pd.Timestamp) -> str:
    """renewalKind() in _shared/membership.ts, applied after the fact to the IST day the next
    membership was created: on or before the end date is early, up to GRACE_DAYS after is grace."""
    if renewed_on <= prev_end:
        return "early"
    return "grace" if (renewed_on - prev_end).days <= GRACE_DAYS else "late"


def membership_frame(ds: Dataset) -> pd.DataFrame:
    """Every membership with: next renewal (if any), churn label (when observable), prior renewal
    kinds, tenure and holds. The label needs end_date + GRACE_DAYS to have passed."""
    m = ds["memberships"].dropna(subset=["student_id", "start_date", "end_date"]).copy()
    m = m.sort_values(["student_id", "start_date", "id"]).reset_index(drop=True)
    m["next_start"] = m.groupby("student_id")["start_date"].shift(-1)
    m["next_created"] = ist_day(m.groupby("student_id")["created_at"].shift(-1))
    # P1.5 label: churned when no new membership starts within GRACE_DAYS after end_date. Known
    # only once that window is over.
    gap = (m["next_start"] - m["end_date"]).dt.days
    m["renewed"] = gap.notna() & (gap <= GRACE_DAYS)
    today = ist_day(pd.Series([ds.as_of]))[0]
    m["observable"] = (m["end_date"] + pd.Timedelta(days=GRACE_DAYS)) < today
    m["churned"] = np.where(m["observable"], (~m["renewed"]).astype(float), np.nan)

    renewed_on = m["next_created"].fillna(m["next_start"])
    kinds = [renewal_kind(e, r) if pd.notna(r) else None for e, r in zip(m["end_date"], renewed_on, strict=True)]
    m["kind_after"] = kinds
    for k in ("early", "grace", "late"):
        flag = (m["kind_after"] == k).astype(int)
        m[f"prior_{k}"] = flag.groupby(m["student_id"]).cumsum() - flag
    m["n_prior"] = m.groupby("student_id").cumcount()
    first = m.groupby("student_id")["start_date"].transform("min")
    m["tenure_days"] = (m["start_date"] - first).dt.days
    m["plan_length"] = (m["end_date"] - m["start_date"]).dt.days + 1

    holds = ds["membership_holds"].groupby("membership_id").agg(holds=("id", "count"), hold_days_taken=("days_paused", "sum"))
    m = m.merge(holds, left_on="id", right_index=True, how="left")
    m[["holds", "hold_days_taken"]] = m[["holds", "hold_days_taken"]].astype(float).fillna(0)
    return m
