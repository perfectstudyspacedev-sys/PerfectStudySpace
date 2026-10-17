"""A made-up study hall with planted signals, for tests and dry runs (no real data needed).

Planted: churners study less in the five weeks before their end date and owe more; one staff member
gives a few very large discounts, cashbacks and waivers; one attendance edit and one overtime
exclusion are far out of line; students are early birds or evening regulars.
"""

from __future__ import annotations

import json
import uuid

import numpy as np
import pandas as pd

from .data import TABLES, Dataset, normalise

AS_OF = pd.Timestamp("2026-10-16T05:30:00Z")
IST = pd.Timedelta(hours=5, minutes=30)


def _uid(rng: np.random.Generator) -> str:
    return str(uuid.UUID(bytes=rng.bytes(16), version=4))


def generate(n_students: int = 160, days: int = 330, seed: int = 7) -> Dataset:
    rng = np.random.default_rng(seed)
    start_day = (AS_OF + IST).tz_localize(None).normalize() - pd.Timedelta(days=days)
    today = (AS_OF + IST).tz_localize(None).normalize()
    branches = [{"id": _uid(rng), "name": n, "is_active": True} for n in ("Hopes", "Ram Nagar")]
    staff = [
        {"id": _uid(rng), "display_name": n, "role": r, "branch_id": b}
        for n, r, b in [
            ("Owner", "owner", None),
            ("Priya", "staff", branches[0]["id"]),
            ("Ravi", "staff", branches[1]["id"]),
            ("Kiran", "staff", branches[0]["id"]),
            ("Dev", "admin", None),  # the hidden admin account: never flagged
        ]
    ]
    desk_staff = staff[1:4]
    t: dict[str, list[dict]] = {k: [] for k in TABLES}
    t["branches"], t["staff"] = branches, staff

    def utc(day: pd.Timestamp, minute: float) -> pd.Timestamp:
        return (day + pd.Timedelta(minutes=float(minute)) - IST).tz_localize("UTC")

    for i in range(n_students):
        sid = _uid(rng)
        branch = branches[i % 2]["id"]
        engagement = rng.uniform(0.25, 1.0)
        early_bird = rng.random() < 0.5
        arrival = rng.normal(7 * 60 if early_bird else 15 * 60, 35)
        hours = int(rng.choice([4, 6, 8], p=[0.3, 0.5, 0.2]))
        fee = {4: 800, 6: 1250, 8: 1500}[hours]
        joined = start_day + pd.Timedelta(days=int(rng.integers(0, days - 60)))
        t["students"].append({"id": sid, "branch_id": branch, "status": "active", "created_at": utc(joined, 600)})
        mstart = joined
        prev_mid = None
        while mstart <= today:
            months = int(rng.choice([1, 3], p=[0.85, 0.15]))
            length = 30 * months
            mend = mstart + pd.Timedelta(days=length - 1)
            plan = fee * months
            churn_p = 1 / (1 + np.exp(-(-0.4 - 4.0 * (engagement - 0.6))))
            will_churn = rng.random() < churn_p
            owes = will_churn and rng.random() < 0.6 or (not will_churn and rng.random() < 0.15)
            paid = plan if not owes else round(plan * rng.uniform(0.3, 0.7))
            mid = _uid(rng)
            created = mstart - pd.Timedelta(days=int(rng.integers(0, 4))) if prev_mid else mstart
            t["memberships"].append(
                {
                    "id": mid,
                    "student_id": sid,
                    "branch_id": branch,
                    "category": "temporary",
                    "hours_per_day": hours,
                    "start_date": mstart,
                    "end_date": mend,
                    "due_date": mend,
                    "months_paid": months,
                    "monthly_fee": fee,
                    "fee_due": plan - paid,
                    "total_paid": paid,
                    "is_active": mend >= today,
                    "hold_days": 0,
                    "renewed_from_membership_id": prev_mid,
                    "plan_amount": plan,
                    "plan_days": length,
                    "created_at": utc(min(created, today), 610),
                }
            )
            t["transactions"].append(
                {
                    "id": _uid(rng),
                    "student_id": sid,
                    "branch_id": branch,
                    "membership_id": mid,
                    "category": "membership",
                    "amount": paid,
                    "payment_mode": "cash",
                    "created_by_staff_id": desk_staff[i % 3]["id"],
                    "created_at": utc(min(mstart, today), 615),
                }
            )
            if rng.random() < 0.05:
                t["membership_holds"].append(
                    {
                        "id": _uid(rng),
                        "membership_id": mid,
                        "student_id": sid,
                        "branch_id": branch,
                        "days_paused": int(rng.integers(2, 8)),
                        "created_at": utc(min(mstart + pd.Timedelta(days=10), today), 700),
                    }
                )
            day = mstart
            while day <= min(mend, today - pd.Timedelta(days=1)):
                p = engagement * (0.55 if day.dayofweek >= 5 else 0.95)
                if will_churn and (mend - day).days < 35:
                    p *= 0.3
                if rng.random() < p:
                    a = arrival + rng.normal(0, 25)
                    used = hours * 60 * rng.uniform(0.6 if engagement < 0.5 else 0.8, 1.05)
                    bid = _uid(rng)
                    t["bookings"].append(
                        {
                            "id": bid,
                            "student_id": sid,
                            "branch_id": branch,
                            "membership_id": mid,
                            "booking_type": "temporary",
                            "status": "completed",
                            "start_time": utc(day, a),
                            "end_time": utc(day, a + used),
                            "hours": hours,
                            "scheduled_hours": hours,
                            "total_pause_minutes": 0,
                            "created_at": utc(day, a),
                        }
                    )
                    if rng.random() < 0.5:
                        r = int(np.clip(round(1.5 + 3.5 * engagement + rng.normal(0, 0.6)), 1, 5))
                        t["focus_ratings"].append({"booking_id": bid, "student_id": sid, "rating": r, "created_at": utc(day, a + used)})
                    if rng.random() < 0.15:
                        t["food_bills"].append(
                            {
                                "id": _uid(rng),
                                "branch_id": branch,
                                "student_id": sid,
                                "total": float(rng.choice([15, 30, 45, 60])),
                                "created_at": utc(day, a + 90),
                            }
                        )
                day += pd.Timedelta(days=1)
            if mend >= today or will_churn:
                break
            prev_mid = mid
            gap = 0 if rng.random() < 0.6 else int(rng.integers(1, 9))
            mstart = mend + pd.Timedelta(days=1 + gap)

    # Money given away: normal amounts by everyone, a few huge ones by Kiran (planted outliers).
    mems = t["memberships"]
    for k in range(60):
        m = mems[int(rng.integers(0, len(mems)))]
        who = desk_staff[k % 3]
        when = utc(min(m["start_date"] + pd.Timedelta(days=5), today), 720)
        t["membership_discounts"].append(
            {
                "id": _uid(rng),
                "membership_id": m["id"],
                "student_id": m["student_id"],
                "branch_id": m["branch_id"],
                "discount_type": "fixed",
                "discount_value": float(rng.integers(100, 300)),
                "discount_amount": float(rng.integers(100, 300)),
                "applied_by_staff_id": who["id"],
                "created_at": when,
            }
        )
        t["cashbacks"].append(
            {
                "id": _uid(rng),
                "student_id": m["student_id"],
                "branch_id": m["branch_id"],
                "cashback_type": "fixed",
                "cashback_value": float(rng.integers(50, 200)),
                "status": "pending",
                "redeemed_amount": None,
                "granted_by_staff_id": who["id"],
                "created_at": when,
            }
        )
        t["waivers"].append(
            {
                "id": _uid(rng),
                "branch_id": m["branch_id"],
                "student_id": m["student_id"],
                "membership_id": m["id"],
                "waiver_type": "overstay",
                "amount": float(rng.integers(40, 200)),
                "created_by_staff_id": who["id"],
                "created_at": when,
            }
        )
    kiran = staff[3]["id"]
    recent = [m for m in mems if (today - m["start_date"]).days < 40][:3]
    planted = {"discount": [], "cashback": [], "waiver": [], "attendance_edit": [], "overtime_exclusion": []}
    for amount, m in zip([1800.0, 2200.0], recent, strict=False):
        row = {
            "id": _uid(rng),
            "membership_id": m["id"],
            "student_id": m["student_id"],
            "branch_id": m["branch_id"],
            "discount_type": "fixed",
            "discount_value": amount,
            "discount_amount": amount,
            "applied_by_staff_id": kiran,
            "created_at": utc(today - pd.Timedelta(days=3), 700),
        }
        t["membership_discounts"].append(row)
        planted["discount"].append(row["id"])
    cb = {
        "id": _uid(rng),
        "student_id": recent[0]["student_id"],
        "branch_id": recent[0]["branch_id"],
        "cashback_type": "fixed",
        "cashback_value": 2500.0,
        "status": "pending",
        "redeemed_amount": None,
        "granted_by_staff_id": kiran,
        "created_at": utc(today - pd.Timedelta(days=2), 700),
    }
    t["cashbacks"].append(cb)
    planted["cashback"].append(cb["id"])
    wv = {
        "id": _uid(rng),
        "branch_id": recent[1]["branch_id"],
        "student_id": recent[1]["student_id"],
        "membership_id": recent[1]["id"],
        "waiver_type": "overstay",
        "amount": 1900.0,
        "created_by_staff_id": kiran,
        "created_at": utc(today - pd.Timedelta(days=4), 700),
    }
    t["waivers"].append(wv)
    planted["waiver"].append(wv["id"])

    # A very large discount by the hidden admin: must never be flagged.
    t["membership_discounts"].append(
        {
            "id": _uid(rng),
            "membership_id": recent[2]["id"],
            "student_id": recent[2]["student_id"],
            "branch_id": recent[2]["branch_id"],
            "discount_type": "fixed",
            "discount_value": 5000.0,
            "discount_amount": 5000.0,
            "applied_by_staff_id": staff[4]["id"],
            "created_at": utc(today - pd.Timedelta(days=2), 700),
        }
    )

    # Manual attendance edits and overtime exclusions, as the event log records them: the payload is
    # what the app sends, and branch_id/student_id are filled only from payload.branchId/studentId.
    def iso(ts: pd.Timestamp) -> str:
        return ts.isoformat().replace("+00:00", "Z")

    ev_id = 0
    for k in range(40):
        ev_id += 1
        b = t["bookings"][int(rng.integers(0, len(t["bookings"])))]
        hours = float(rng.choice([2, 3, 4, 5, 6]))
        start, end = b["start_time"], b["start_time"] + pd.Timedelta(hours=hours)
        if k % 2:
            payload = {"bookingId": b["id"], "startTime": iso(start), "endTime": iso(end), "scheduledHours": hours}
            branch, student = None, None
        else:
            payload = {"branchId": b["branch_id"], "studentId": b["student_id"], "startTime": iso(start), "endTime": iso(end)}
            branch, student = b["branch_id"], b["student_id"]
        t["events"].append(
            {
                "id": ev_id,
                "occurred_at": b["start_time"] + pd.Timedelta(hours=8),
                "action": "update_attendance" if k % 2 else "add_attendance",
                "actor_type": "staff",
                "actor_id": desk_staff[k % 3]["id"],
                "branch_id": branch,
                "student_id": student,
                "ok": True,
                "payload": json.dumps(payload),
            }
        )
    ev_id += 1
    day_before = today - pd.Timedelta(days=1)
    big = {
        "id": ev_id,
        "occurred_at": AS_OF - pd.Timedelta(days=1),
        "action": "add_attendance",
        "actor_type": "staff",
        "actor_id": kiran,
        "branch_id": branches[0]["id"],
        "student_id": t["students"][0]["id"],
        "ok": True,
        "payload": json.dumps(
            {
                "branchId": branches[0]["id"],
                "studentId": t["students"][0]["id"],
                "startTime": iso(utc(day_before, 6 * 60)),
                "endTime": iso(utc(day_before, 22 * 60)),
            }
        ),
    }
    t["events"].append(big)
    planted["attendance_edit"].append(big["id"])
    for k in range(30):
        b = t["bookings"][int(rng.integers(0, len(t["bookings"])))]
        ot = {
            "id": _uid(rng),
            "student_id": b["student_id"],
            "membership_id": b["membership_id"],
            "branch_id": b["branch_id"],
            "overtime_minutes": int(rng.integers(20, 60)),
            "billed_amount": float(rng.integers(15, 45)),
            "excluded": k % 3 == 0,
            "session_date": (b["start_time"] + IST).tz_localize(None).normalize(),
            "created_at": b["end_time"],
        }
        t["overtime_sessions"].append(ot)
        if ot["excluded"]:
            ev_id += 1
            t["events"].append(
                {
                    "id": ev_id,
                    "occurred_at": b["end_time"] + pd.Timedelta(hours=1),
                    "action": "set_overtime_excluded",
                    "actor_type": "staff",
                    "actor_id": desk_staff[k % 3]["id"],
                    "branch_id": None,
                    "student_id": None,
                    "ok": True,
                    "payload": json.dumps({"overtimeSessionId": ot["id"], "excluded": True, "reason": "wifi down"}),
                }
            )
    b = t["bookings"][-1]
    ot = {
        "id": _uid(rng),
        "student_id": b["student_id"],
        "membership_id": b["membership_id"],
        "branch_id": b["branch_id"],
        "overtime_minutes": 600,
        "billed_amount": 400.0,
        "excluded": True,
        "session_date": (b["start_time"] + IST).tz_localize(None).normalize(),
        "created_at": b["end_time"],
    }
    t["overtime_sessions"].append(ot)
    ev_id += 1
    t["events"].append(
        {
            "id": ev_id,
            "occurred_at": AS_OF - pd.Timedelta(days=9),
            "action": "set_overtime_excluded",
            "actor_type": "staff",
            "actor_id": kiran,
            "branch_id": None,
            "student_id": None,
            "ok": True,
            "payload": json.dumps({"overtimeSessionId": ot["id"], "excluded": True, "reason": "friend"}),
        }
    )
    planted["overtime_exclusion"].append(ot["id"])

    tables = {name: normalise(name, pd.DataFrame(rows, columns=TABLES[name])) for name, rows in t.items()}
    ds = Dataset(tables, AS_OF)
    ds.planted = planted  # type: ignore[attr-defined]
    return ds
