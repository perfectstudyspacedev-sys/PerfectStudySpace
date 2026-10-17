import pandas as pd

from pss_ml.features import membership_frame, renewal_kind, student_days
from tests.conftest import tiny

D = pd.Timestamp


def booking(i, start, end, sched=6, pause=0, kind="temporary", student="s1"):
    return {
        "id": f"b{i}",
        "student_id": student,
        "branch_id": "br",
        "membership_id": "m1",
        "booking_type": kind,
        "status": "completed",
        "start_time": start,
        "end_time": end,
        "hours": sched,
        "scheduled_hours": sched,
        "total_pause_minutes": pause,
        "created_at": start,
    }


def test_student_days_use_ist_days_minutes_and_pauses():
    ds = tiny(
        bookings=[
            booking(1, "2026-10-14T23:30:00Z", "2026-10-15T05:30:00Z", pause=30),  # 05:00–11:00 IST on 15 Oct
            booking(2, "2026-10-15T08:30:00Z", "2026-10-15T09:30:00Z", sched=2),  # 14:00 IST, same day
            booking(3, "2026-10-15T03:30:00Z", "2026-10-15T05:30:00Z", kind="walkin"),  # walk-ins are not members
        ],
        focus_ratings=[{"booking_id": "b1", "student_id": "s1", "rating": 4, "created_at": "2026-10-15T05:30:00Z"}],
        food_bills=[{"id": "f1", "branch_id": "br", "student_id": "s1", "total": 45, "created_at": "2026-10-15T06:00:00Z"}],
    )
    d = student_days(ds)
    assert len(d) == 1
    row = d.iloc[0]
    assert row["day"] == D("2026-10-15") and row["arrival_minute"] == 5 * 60 and row["sessions"] == 2
    assert row["minutes_used"] == 330 + 60 and row["scheduled_minutes"] == 8 * 60
    assert abs(row["usage_ratio"] - 390 / 480) < 1e-9 and row["food_spend"] == 45 and row["focus"] == 4
    assert not row["weekend"]


def test_renewal_kind_matches_the_api_rule():
    end = D("2026-10-10")
    assert renewal_kind(end, D("2026-10-08")) == "early"
    assert renewal_kind(end, D("2026-10-10")) == "early"
    assert renewal_kind(end, D("2026-10-20")) == "grace"
    assert renewal_kind(end, D("2026-10-21")) == "late"


def mem(i, student, start, end, created=None):
    return {
        "id": f"m{i}",
        "student_id": student,
        "branch_id": "br",
        "category": "temporary",
        "hours_per_day": 6,
        "start_date": start,
        "end_date": end,
        "due_date": end,
        "months_paid": 1,
        "monthly_fee": 1250,
        "fee_due": 0,
        "total_paid": 1250,
        "is_active": False,
        "hold_days": 0,
        "plan_amount": 1250,
        "plan_days": 30,
        "created_at": created or f"{start}T05:00:00Z",
    }


def test_churn_label_needs_a_new_start_within_ten_days_and_a_finished_window():
    ds = tiny(
        memberships=[
            mem(1, "a", "2026-07-01", "2026-07-30"),
            mem(2, "a", "2026-08-09", "2026-09-07", "2026-08-09T05:00:00Z"),  # 10 days later
            mem(3, "b", "2026-07-01", "2026-07-30"),
            mem(4, "b", "2026-08-10", "2026-09-08"),  # 11 days later
            mem(5, "c", "2026-09-10", "2026-10-09"),  # window ends 19 Oct — not known yet on 16 Oct
            mem(6, "d", "2026-08-01", "2026-08-30"),  # never came back
        ]
    )
    m = membership_frame(ds).set_index("id")
    assert m.loc["m1", "churned"] == 0 and m.loc["m3", "churned"] == 1 and m.loc["m6", "churned"] == 1
    assert pd.isna(m.loc["m5", "churned"]) and not m.loc["m5", "observable"]
    assert m.loc["m1", "kind_after"] == "grace" and m.loc["m2", "prior_grace"] == 1 and m.loc["m2", "n_prior"] == 1
    assert m.loc["m2", "tenure_days"] == 39
