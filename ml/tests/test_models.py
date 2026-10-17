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


def test_churn_scores_every_active_member_once_with_a_known_reason(result, synthetic):
    s = result.scores
    assert s["student_id"].is_unique and len(s) == len(fingerprint.active_students(synthetic))
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
