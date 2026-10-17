"""P1.6 — anomaly detector. Each discount, cashback, waiver, manual attendance edit and overtime
exclusion is compared with the same staff member's history, the branch's history and, when those are
too short, every record of its kind (robust z-score: distance from the median in MADs). The top
ANOMALY_TOP_N per week above ANOMALY_MIN_SCORE become flags. Explanations come from fixed templates,
never from a language model."""

from __future__ import annotations

import json
import uuid

import numpy as np
import pandas as pd

from .config import ANOMALY_MIN_SCORE, ANOMALY_TOP_N
from .data import Dataset

EVENT_NS = uuid.UUID("6f1c2f0e-4b8e-4d56-9b0a-5a1f3c9e7d21")  # events have numeric ids; flags need a uuid


def event_ref(event_id) -> str:
    return str(uuid.uuid5(EVENT_NS, f"events:{int(event_id)}"))


def records(ds: Dataset) -> pd.DataFrame:
    """One row per checked record: kind, ref, staff, branch, value (₹ or hours), when."""
    parts = []
    d = ds["membership_discounts"]
    parts.append(
        pd.DataFrame(
            {
                "kind": "discount",
                "ref_table": "membership_discounts",
                "ref_id": d["id"],
                "staff_id": d["applied_by_staff_id"],
                "branch_id": d["branch_id"],
                "value": d["discount_amount"].astype(float),
                "unit": "₹",
                "at": d["created_at"],
            }
        )
    )
    c = ds["cashbacks"]
    c = c[c["cashback_type"] == "fixed"]  # a percent has no amount until it is used
    parts.append(
        pd.DataFrame(
            {
                "kind": "cashback",
                "ref_table": "cashbacks",
                "ref_id": c["id"],
                "staff_id": c["granted_by_staff_id"],
                "branch_id": c["branch_id"],
                "value": c["cashback_value"].astype(float),
                "unit": "₹",
                "at": c["created_at"],
            }
        )
    )
    w = ds["waivers"]
    w = w[w["waiver_type"] != "overtime_restore"]
    parts.append(
        pd.DataFrame(
            {
                "kind": "waiver",
                "ref_table": "waivers",
                "ref_id": w["id"],
                "staff_id": w["created_by_staff_id"],
                "branch_id": w["branch_id"],
                "value": w["amount"].astype(float),
                "unit": "₹",
                "at": w["created_at"],
            }
        )
    )
    ev = ds["events"].copy()
    if not ev.empty:
        ev["p"] = ev["payload"].map(lambda p: json.loads(p) if isinstance(p, str) else (p or {}))
        att = ev[ev["action"].isin(["add_attendance", "update_attendance"])]
        hours = att["p"].map(lambda p: p.get("hours"))
        parts.append(
            pd.DataFrame(
                {
                    "kind": "attendance_edit",
                    "ref_table": "events",
                    "ref_id": att["id"].map(event_ref),
                    "staff_id": att["actor_id"],
                    "branch_id": att["branch_id"],
                    "value": pd.to_numeric(hours, errors="coerce"),
                    "unit": "h",
                    "at": att["occurred_at"],
                }
            )
        )
        exc = ev[(ev["action"] == "set_overtime_excluded") & ev["p"].map(lambda p: p.get("excluded") is True)]
        ot = ds["overtime_sessions"].set_index("id")["billed_amount"]
        oid = exc["p"].map(lambda p: p.get("overtimeId"))
        parts.append(
            pd.DataFrame(
                {
                    "kind": "overtime_exclusion",
                    "ref_table": "overtime_sessions",
                    "ref_id": oid,
                    "staff_id": exc["actor_id"],
                    "branch_id": exc["branch_id"],
                    "value": oid.map(ot).astype(float),
                    "unit": "₹",
                    "at": exc["occurred_at"],
                }
            )
        )
    r = pd.concat([p for p in parts if not p.empty], ignore_index=True)
    return r.dropna(subset=["value", "ref_id"])


def _robust_z(values: pd.Series) -> pd.Series:
    """Leave-one-out robust z-score: each value against the median/MAD of the others."""
    v = values.to_numpy(dtype=float)
    out = np.full(len(v), np.nan)
    for i in range(len(v)):
        rest = np.delete(v, i)
        if len(rest) < 4:
            continue
        med = np.median(rest)
        mad = np.median(np.abs(rest - med)) * 1.4826
        scale = max(mad, 0.25 * abs(med), 1.0)  # a tight history must not turn small changes into alarms
        out[i] = (v[i] - med) / scale
    return pd.Series(out, index=values.index)


def detect(ds: Dataset, top_n: int = ANOMALY_TOP_N, min_score: float = ANOMALY_MIN_SCORE) -> pd.DataFrame:
    r = records(ds)
    if r.empty:
        return pd.DataFrame(columns=["kind", "ref_table", "ref_id", "branch_id", "score", "explanation"])
    levels = {"staff": ["kind", "staff_id"], "branch": ["kind", "branch_id"], "all": ["kind"]}
    for level, keys in levels.items():
        g = r.groupby(keys, dropna=False)["value"]
        r[f"z_{level}"] = g.transform(_robust_z)
        r[f"median_{level}"] = g.transform(lambda v: v.median() if len(v) < 2 else v.drop(v.idxmax()).median())
    z = r[[f"z_{lv}" for lv in levels]]
    r["score"] = z.max(axis=1)
    r["level"] = z.fillna(-np.inf).idxmax(axis=1).str[2:]
    r = r[r["score"] >= min_score].copy()
    if r.empty:
        return pd.DataFrame(columns=["kind", "ref_table", "ref_id", "branch_id", "score", "explanation"])
    names = ds["staff"].set_index("id")["display_name"]
    r["week"] = r["at"].dt.tz_convert(None).dt.to_period("W-SUN")
    r = r.sort_values("score", ascending=False).groupby("week").head(top_n)
    r["explanation"] = [_explain(row, names) for row in r.itertuples()]
    r["score"] = r["score"].round(2)
    return r[["kind", "ref_table", "ref_id", "branch_id", "score", "explanation"]].reset_index(drop=True)


LABEL = {
    "discount": "discount",
    "cashback": "cashback",
    "waiver": "waiver",
    "attendance_edit": "attendance entry",
    "overtime_exclusion": "overtime excluded",
}


def _amount(v: float, unit: str) -> str:
    return f"₹{v:,.0f}" if unit == "₹" else f"{v:g} h"


def _explain(row, names: pd.Series) -> str:
    who = names.get(row.staff_id, "an unknown staff member") if isinstance(row.staff_id, str) else "an unknown staff member"
    base = getattr(row, f"median_{row.level}")
    whose = {"staff": f"{who}'s usual", "branch": "the branch's usual", "all": "the usual"}[row.level]
    times = f"about {row.value / base:.0f}× " if base and base > 0 else ""
    return (
        f"{_amount(row.value, row.unit)} {LABEL[row.kind]} by {who} on {row.at.tz_convert('Asia/Kolkata'):%d %b} — "
        f"{times}{whose} ({_amount(base, row.unit)})."
    )
