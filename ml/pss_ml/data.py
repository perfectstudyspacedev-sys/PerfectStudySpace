"""What the models read. Export (P1.2) writes these tables to ml/data/ as Parquet; tests build the
same shape from pss_ml.synthetic. Only ids, dates, amounts and statuses are exported — no names,
phone numbers, photos or Aadhaar data (R11)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import DATA_DIR

# table -> exported columns (PostgREST select list). Keep personal data out.
TABLES: dict[str, list[str]] = {
    "students": ["id", "branch_id", "status", "created_at"],
    "staff": ["id", "display_name", "role", "branch_id"],
    "branches": ["id", "name", "is_active"],
    "memberships": [
        "id",
        "student_id",
        "branch_id",
        "category",
        "hours_per_day",
        "start_date",
        "end_date",
        "due_date",
        "months_paid",
        "monthly_fee",
        "fee_due",
        "total_paid",
        "is_active",
        "hold_days",
        "renewed_from_membership_id",
        "plan_amount",
        "plan_days",
        "created_at",
    ],
    "bookings": [
        "id",
        "student_id",
        "branch_id",
        "membership_id",
        "booking_type",
        "status",
        "start_time",
        "end_time",
        "hours",
        "scheduled_hours",
        "total_pause_minutes",
        "created_at",
    ],
    "transactions": [
        "id",
        "student_id",
        "branch_id",
        "membership_id",
        "category",
        "amount",
        "payment_mode",
        "created_by_staff_id",
        "created_at",
    ],
    "focus_ratings": ["booking_id", "student_id", "rating", "created_at"],
    "waivers": ["id", "branch_id", "student_id", "membership_id", "waiver_type", "amount", "created_by_staff_id", "created_at"],
    "cashbacks": [
        "id",
        "student_id",
        "branch_id",
        "cashback_type",
        "cashback_value",
        "status",
        "redeemed_amount",
        "granted_by_staff_id",
        "created_at",
    ],
    "membership_discounts": [
        "id",
        "membership_id",
        "student_id",
        "branch_id",
        "discount_type",
        "discount_value",
        "discount_amount",
        "applied_by_staff_id",
        "created_at",
    ],
    "membership_holds": ["id", "membership_id", "student_id", "branch_id", "days_paused", "created_at"],
    "food_bills": ["id", "branch_id", "student_id", "total", "created_at"],
    "overtime_sessions": [
        "id",
        "student_id",
        "membership_id",
        "branch_id",
        "overtime_minutes",
        "billed_amount",
        "excluded",
        "session_date",
        "created_at",
    ],
    # Only the manual edits the anomaly detector looks at (P1.6); payloads are already redacted.
    "events": ["id", "occurred_at", "action", "actor_type", "actor_id", "branch_id", "student_id", "ok", "payload"],
}
EVENT_ACTIONS = ("add_attendance", "update_attendance", "set_overtime_excluded")
ORDER = {"focus_ratings": "booking_id"}
# Never exported or published. "name" is personal everywhere except branches.name.
PERSONAL = {
    "phone",
    "student_name",
    "student_phone",
    "emergency_contact",
    "aadhaar_photo_url",
    "photo_url",
    "password_hash",
    "username",
    "course",
}


def personal_columns(table: str) -> set[str]:
    return PERSONAL | (set() if table == "branches" else {"name"})


TIMESTAMPS = {"created_at", "start_time", "end_time", "occurred_at"}
DATES = {"start_date", "end_date", "due_date", "session_date"}


@dataclass
class Dataset:
    tables: dict[str, pd.DataFrame]
    as_of: pd.Timestamp  # the moment the export was taken (UTC)

    def __getitem__(self, name: str) -> pd.DataFrame:
        return self.tables[name]


def normalise(name: str, df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in TABLES[name]:
        if col not in df.columns:
            df[col] = pd.NA
    for col in df.columns:
        if col in TIMESTAMPS:
            df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
        elif col in DATES:
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.normalize()
    return df[TABLES[name]]


def load(data_dir: Path = DATA_DIR) -> Dataset:
    tables = {name: normalise(name, pd.read_parquet(data_dir / f"{name}.parquet")) for name in TABLES}
    stamp = (data_dir / "EXPORTED_AT").read_text().strip()
    return Dataset(tables, pd.Timestamp(stamp))
