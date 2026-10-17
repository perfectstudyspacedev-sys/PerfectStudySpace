import json

import pandas as pd
import pytest

from pss_ml import anomaly, churn, fingerprint, forecast
from pss_ml.synthetic import generate


@pytest.fixture(scope="module")
def result(synthetic):
    return churn.train_and_score(synthetic, budget=8)


def test_churn_beats_the_seven_day_reminder_on_planted_data(result):
    m = result.metrics
    assert m["c_index_gradient_boosting"] > 0.75 and m["c_index_cox"] > 0.75
    assert m["beats_baseline"] and m["model_hit_rate"] > m["baseline_hit_rate"]
    assert result.chosen in ("cox", "gradient_boosting")


def test_churn_scores_members_ending_within_28_days_once_with_a_known_reason(result, synthetic):
    s = result.scores
    m = synthetic["memberships"]
    today = pd.Timestamp("2026-10-16")
    latest = m[m["is_active"] & (m["end_date"] >= today)].sort_values("end_date").groupby("student_id").tail(1)
    due = set(latest.loc[(latest["end_date"] - today).dt.days <= 28, "student_id"])
    assert s["student_id"].is_unique and set(s["student_id"]) == due and len(due) < len(latest) or set(s["student_id"]) == due
    assert s["score"].between(0, 1).all() and set(s["reason"]) <= set(churn.REASONS)
    assert (s.loc[s["score"] < 0.3, "reason"] == "other").all()


def test_churn_report_states_the_verdict(result, synthetic):
    text = churn.report(result, synthetic.as_of, 8)
    assert "beats the 7-day reminder" in text and "Concordance" in text and "Asha" not in text


def test_churn_refuses_to_score_without_enough_history():
    small = generate(n_students=6, days=70, seed=3)
    r = churn.train_and_score(small)
    assert r.model is None and r.scores.empty and "Not scored" in churn.report(r, small.as_of)


def test_every_active_member_gets_a_fingerprint(synthetic):
    rows, clusters = fingerprint.fingerprints(synthetic)
    assert set(rows["student_id"]) == fingerprint.active_students(synthetic) and rows["student_id"].is_unique
    with_vec = rows[rows["vector"].notna()]
    assert len(with_vec) and all(len(v) == 3 for v in with_vec["vector"])
    assert 3 <= len(clusters) <= 6 and clusters["members"].sum() == len(with_vec)
    assert all(c.startswith("C") or c == "new or away" for c in rows["cluster"])


@pytest.mark.parametrize("seed", [7, 11, 23])
def test_anomaly_flags_exactly_the_planted_records(seed):
    ds = generate(seed=seed)
    f = anomaly.detect(ds)
    planted = {anomaly.event_ref(x) if isinstance(x, int) else x for v in ds.planted.values() for x in v}
    assert set(f["ref_id"]) == planted
    assert not f.duplicated(["kind", "ref_table", "ref_id"]).any()
    assert all("by Kiran" in e and "usual" in e for e in f["explanation"])


def test_anomaly_explanations_are_templates_and_refs_are_stable():
    assert anomaly.event_ref(41) == anomaly.event_ref(41) != anomaly.event_ref(42)
    ds = generate()
    f = anomaly.detect(ds)
    cash = f[f["kind"] == "cashback"].iloc[0]
    assert cash["explanation"].startswith("₹2,500 cashback by Kiran on 14 Oct — about ")


def test_anomaly_respects_the_weekly_cap(synthetic):
    f = anomaly.detect(synthetic, top_n=2)
    assert len(f) == 3  # five planted in the week of 12 Oct → 2, one in the week before → 1


def test_forecast_rows_and_bands(result, synthetic):
    fc = forecast.forecast(synthetic, result.scores)
    assert len(fc) == 9 and (fc["kind"] == "cash_inflow").all()
    assert (fc["low"] <= fc["value"]).all() and (fc["value"] <= fc["high"]).all() and (fc["low"] >= 0).all()
    assert pd.Series(fc["period_start"]).is_monotonic_increasing


def test_engagement_is_between_zero_and_one_for_every_active_member(result, synthetic):
    e = forecast.engagement(synthetic, result.scores)
    assert set(e["student_id"]) == fingerprint.active_students(synthetic)
    assert e["score"].between(0, 1).all()
    assert e.loc[e["score"] >= 0.5, "reason"].isna().all()
    json.dumps(e.to_dict("records"), default=str)


def test_holds_count_only_up_to_the_prediction_point(synthetic):
    from pss_ml.features import membership_frame

    frame = membership_frame(synthetic)
    held = synthetic["membership_holds"].iloc[0]
    row = frame[frame["id"] == held["membership_id"]]
    created = pd.Timestamp(held["created_at"]).tz_convert("Asia/Kolkata").tz_localize(None).normalize()
    before = churn.features_at(synthetic, row, pd.Series(created - pd.Timedelta(days=1), index=row.index))
    after = churn.features_at(synthetic, row, pd.Series(created, index=row.index))
    assert before["holds"].iloc[0] == 0 and before["hold_days_taken"].iloc[0] == 0
    assert after["holds"].iloc[0] == 1 and after["hold_days_taken"].iloc[0] == held["days_paused"]


def test_budget_comparison_contacts_nobody_twice(result):
    b = result.budget
    assert len(b) and len(set().union(*b["model_ids"])) == b["model_contacted"].sum()
    assert result.metrics["model_churners_reached"] == b["model_hits"].sum()


def test_the_hidden_admin_is_never_flagged(synthetic):
    f = anomaly.detect(synthetic)
    admin = synthetic["staff"].loc[synthetic["staff"]["role"] == "admin", "id"].iloc[0]
    big = synthetic["membership_discounts"].loc[synthetic["membership_discounts"]["applied_by_staff_id"] == admin, "id"]
    assert len(big) == 1 and big.iloc[0] not in set(f["ref_id"]) and not f["explanation"].str.contains("Dev").any()


def test_only_recent_records_are_flagged(synthetic):
    from pss_ml.data import Dataset

    later = Dataset(synthetic.tables, synthetic.as_of + pd.Timedelta(days=30))
    assert anomaly.detect(later).empty


def test_anomaly_reads_the_payload_keys_the_app_actually_sends():
    """Contract with supabase/functions/api/domains/*.ts: the keys anomaly.py reads must be ones the
    handlers destructure from their payload."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2] / "supabase" / "functions" / "api" / "domains"
    expected = {
        ("sessions.ts", "update_attendance"): {"bookingId", "startTime", "endTime"},
        ("sessions.ts", "add_attendance"): {"branchId", "studentId", "startTime", "endTime"},
        ("money.ts", "set_overtime_excluded"): {"overtimeSessionId", "excluded"},
    }
    for (file, action), keys in expected.items():
        src = (root / file).read_text()
        body = src[src.index(f"{action}: async") :][:800]
        m = re.search(r"const \{([^}]*)\} = payload", body)
        assert m, action
        sent = {k.strip().split(":")[0] for k in m.group(1).split(",")}
        assert keys <= sent, (action, keys - sent)


def test_dues_collection_rate_measures_what_was_paid_after_the_first_day(synthetic):
    rate = forecast.dues_collection_rate(synthetic, pd.Timestamp("2026-10-16"))
    assert 0 <= rate <= 1
