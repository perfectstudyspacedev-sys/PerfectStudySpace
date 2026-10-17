"""P1.2 — export the tables the models need from Supabase to ml/data/*.parquet."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from .config import DATA_DIR
from .data import EVENT_ACTIONS, ORDER, TABLES, personal_columns
from .supabase_io import Supabase


def export(db: Supabase, out_dir: Path = DATA_DIR, now: pd.Timestamp | None = None) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for name, columns in TABLES.items():
        assert not personal_columns(name) & set(columns), f"{name} would export personal data"
        filters = {"action": f"in.({','.join(EVENT_ACTIONS)})", "ok": "eq.true"} if name == "events" else None
        rows = db.select_all(name, columns, filters, key=ORDER.get(name, "id"))
        df = pd.DataFrame(rows, columns=columns)
        if name == "events":
            df["payload"] = df["payload"].map(lambda p: None if p is None else json.dumps(p))
        df.to_parquet(out_dir / f"{name}.parquet", index=False)
        counts[name] = len(df)
    (out_dir / "EXPORTED_AT").write_text((now or pd.Timestamp.now(tz="UTC")).isoformat())
    return counts
