"""P1.2/P1.3 — write model results back to Supabase (tables from migration 056).

Only ids, scores, short reason codes, cluster labels, template explanations and weekly totals are
written — never names, phone numbers or payment details. --dry-run writes the same rows to ml/out/
instead.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .config import MODEL_VERSION, OUT_DIR
from .data import PERSONAL
from .supabase_io import Supabase


def _records(df: pd.DataFrame) -> list[dict]:
    rows = json.loads(df.to_json(orient="records", date_format="iso"))
    for r in rows:
        bad = (PERSONAL | {"name", "display_name"}) & set(r)
        assert not bad, f"refusing to publish personal fields {bad}"
    return rows


def build(
    churn: pd.DataFrame,
    engagement: pd.DataFrame,
    fingerprints: pd.DataFrame,
    flags: pd.DataFrame,
    forecast: pd.DataFrame,
    computed_at: pd.Timestamp,
    labels: dict[str, str] | None = None,
) -> dict[str, list[dict]]:
    at = computed_at.isoformat()
    scores = []
    if not churn.empty:
        scores.append(churn.assign(model="churn", version=MODEL_VERSION))
    if not engagement.empty:
        scores.append(engagement.assign(model="engagement", version=MODEL_VERSION))
    score_rows = (
        pd.concat(scores, ignore_index=True)[["student_id", "model", "version", "score", "reason"]].assign(computed_at=at)
        if scores
        else pd.DataFrame()
    )
    prints = fingerprints.copy()
    if labels and not prints.empty:
        prints["cluster"] = prints["cluster"].map(lambda c: labels.get(c, c))
    flag_rows = flags.assign(status="open").replace({np.nan: None}) if not flags.empty else flags
    return {
        "student_scores": _records(score_rows) if not score_rows.empty else [],
        "fingerprints": _records(prints.assign(computed_at=at)) if not prints.empty else [],
        "anomaly_flags": _records(flag_rows) if not flag_rows.empty else [],
        "forecasts": _records(forecast.assign(computed_at=at)) if not forecast.empty else [],
    }


def publish(rows: dict[str, list[dict]], db: Supabase | None, today: str, dry_run: bool = False, out_dir: Path = OUT_DIR) -> dict[str, int]:
    counts = {k: len(v) for k, v in rows.items()}
    if dry_run or db is None:
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, data in rows.items():
            (out_dir / f"{name}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
        return counts
    if rows["student_scores"]:
        db.upsert("student_scores", rows["student_scores"], on_conflict="student_id,model")
        db.insert("student_score_history", rows["student_scores"])
    if rows["fingerprints"]:
        db.upsert("fingerprints", rows["fingerprints"], on_conflict="student_id")
    if rows["anomaly_flags"]:
        # A flag already published (and maybe already reviewed) is left exactly as it is.
        db.upsert("anomaly_flags", rows["anomaly_flags"], on_conflict="kind,ref_table,ref_id", ignore_duplicates=True)
    if rows["forecasts"]:
        kinds = sorted({r["kind"] for r in rows["forecasts"]})
        for kind in kinds:
            db.delete("forecasts", {"kind": f"eq.{kind}", "period_start": f"gte.{today}"})
        db.insert("forecasts", rows["forecasts"])
    return counts
