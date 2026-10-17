"""P1.5 — churn model.

Label: a membership churns when no new membership for the student starts within GRACE_DAYS after its
end date. Prediction point: PREDICTION_DAYS before the end date. Two models — a Cox baseline
(lifelines) and gradient boosting (scikit-learn) — are validated on the most recent months
(time-based split) and the better one is kept. The report compares it with today's practice,
"remind everyone expiring in the next 7 days", at the owner's weekly contact budget.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from lifelines import CoxPHFitter
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from .config import CONTACT_BUDGET, GRACE_DAYS, MODEL_VERSION, PREDICTION_DAYS, TEST_DAYS
from .data import Dataset
from .features import ist_day, membership_frame, student_days

# Offsets (days before end) at which training rows are taken, so a member can be scored on any day
# of their last four weeks; days_to_end is a feature. PREDICTION_DAYS is the headline one.
TRAIN_OFFSETS = (7, 14, PREDICTION_DAYS, 28)

FEATURE_GROUPS: dict[str, list[str]] = {
    "attendance_drop": ["visits_14", "visits_prev_14", "attendance_trend", "days_since_last_visit", "usage_14"],
    "dues": ["dues_at_point", "dues_ratio"],
    "short_tenure": ["tenure_days", "n_prior"],
    "holds": ["holds", "hold_days_taken"],
    "late_payer": ["prior_early", "prior_grace", "prior_late"],
    "other": ["focus_28", "hours_per_day", "months_paid", "plan_length", "days_to_end"],
}
FEATURES = [f for group in FEATURE_GROUPS.values() for f in group]
REASONS = [g for g in FEATURE_GROUPS if g != "other"] + ["other"]


def _paid_by(ds: Dataset) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    tx = ds["transactions"]
    tx = tx[tx["membership_id"].notna() & (tx["category"] == "membership")].sort_values("created_at")
    out = {}
    for mid, g in tx.groupby("membership_id"):
        out[mid] = (ist_day(g["created_at"]).to_numpy(), g["amount"].astype(float).cumsum().to_numpy())
    return out


def features_at(ds: Dataset, members: pd.DataFrame, points: pd.Series, days: pd.DataFrame | None = None) -> pd.DataFrame:
    """Features of each membership row as of its point (an IST day), using only data up to then."""
    days = student_days(ds) if days is None else days
    by_student = {sid: g for sid, g in days.groupby("student_id")}
    paid = _paid_by(ds)
    rows = []
    for (_, m), point in zip(members.iterrows(), points, strict=True):
        g = by_student.get(m["student_id"])
        if g is not None:
            g = g[g["day"] <= point]
        if g is None or g.empty:
            v14 = vprev = 0
            last_gap = 60.0
            usage = focus = np.nan
        else:
            age = (point - g["day"]).dt.days
            recent = g[age < 14]
            v14 = len(recent)
            vprev = int(((age >= 14) & (age < 28)).sum())
            last_gap = float(min(age.min(), 60))
            usage = recent["usage_ratio"].mean() if v14 else np.nan
            focus = g[age < 28]["focus"].mean()
        plan = m["plan_amount"] if pd.notna(m["plan_amount"]) else (m["monthly_fee"] or 0) * (m["months_paid"] or 1)
        paid_days, paid_cum = paid.get(m["id"], (np.array([], dtype="datetime64[ns]"), np.array([])))
        k = np.searchsorted(paid_days, np.datetime64(point), side="right")
        paid_now = float(paid_cum[k - 1]) if k else 0.0
        dues = max(float(plan or 0) - paid_now, 0.0)
        rows.append(
            {
                "visits_14": v14,
                "visits_prev_14": vprev,
                "attendance_trend": v14 - vprev,
                "days_since_last_visit": last_gap,
                "usage_14": usage,
                "focus_28": focus,
                "dues_at_point": dues,
                "dues_ratio": dues / plan if plan else 0.0,
                "tenure_days": m["tenure_days"],
                "n_prior": m["n_prior"],
                "prior_early": m["prior_early"],
                "prior_grace": m["prior_grace"],
                "prior_late": m["prior_late"],
                "holds": m["holds"],
                "hold_days_taken": m["hold_days_taken"],
                "hours_per_day": m["hours_per_day"],
                "months_paid": m["months_paid"],
                "plan_length": m["plan_length"],
                "days_to_end": (m["end_date"] - point).days,
            }
        )
    return pd.DataFrame(rows, index=members.index, columns=FEATURES).astype(float)


def training_rows(ds: Dataset, frame: pd.DataFrame, days: pd.DataFrame) -> pd.DataFrame:
    labelled = frame[frame["observable"]]
    parts = []
    for off in TRAIN_OFFSETS:
        point = (labelled["end_date"] - pd.Timedelta(days=off)).clip(lower=labelled["start_date"])
        x = features_at(ds, labelled, point, days)
        x["membership_id"], x["student_id"], x["branch_id"] = labelled["id"], labelled["student_id"], labelled["branch_id"]
        x["end_date"], x["point"], x["offset"] = labelled["end_date"], point, off
        x["churned"] = labelled["churned"]
        x["renew_in"] = (labelled["next_start"] - point).dt.days
        parts.append(x.reset_index(drop=True))
    return pd.concat(parts, ignore_index=True)


class Model:
    name = ""

    def fit(self, rows: pd.DataFrame) -> Model: ...
    def predict(self, x: pd.DataFrame) -> np.ndarray: ...


class GBM(Model):
    name = "gradient_boosting"

    def fit(self, rows):
        self.clf = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.06, max_iter=250, l2_regularization=1.0, random_state=0)
        self.clf.fit(rows[FEATURES], rows["churned"].astype(int))
        return self

    def predict(self, x):
        return self.clf.predict_proba(x[FEATURES])[:, 1]


class Cox(Model):
    """Time to renewal from the point; churn risk = probability of no renewal by end + grace."""

    name = "cox"

    def fit(self, rows):
        self.medians = rows[FEATURES].median().fillna(0)
        x = rows[FEATURES].fillna(self.medians)
        self.cols = [c for c in FEATURES if x[c].std() > 0]
        horizon = rows["days_to_end"] + GRACE_DAYS
        renewed = rows["churned"] == 0
        df = x[self.cols].copy()
        df["T"] = np.where(renewed, rows["renew_in"].clip(lower=1), horizon).astype(float)
        df["T"] = df["T"].clip(lower=1)
        df["E"] = renewed.astype(int)
        self.cph = CoxPHFitter(penalizer=0.1).fit(df, duration_col="T", event_col="E")
        return self

    def predict(self, x):
        xx = x[FEATURES].fillna(self.medians)[self.cols]
        haz = self.cph.predict_partial_hazard(xx).to_numpy()
        base = self.cph.baseline_cumulative_hazard_
        t = (x["days_to_end"] + GRACE_DAYS).to_numpy()
        h0 = np.interp(t, base.index.to_numpy(), base.iloc[:, 0].to_numpy())
        return np.exp(-h0 * haz)  # P(no renewal by end + grace)


def reasons(model: Model, x: pd.DataFrame, reference: pd.Series) -> list[str]:
    """Top contributing feature group: how much the score falls when that group is set to the
    training median. 'other' when no group adds at least 0.02 (and, in the published scores, for
    anyone under 0.3 risk)."""
    base = model.predict(x)
    gains = {}
    for group, cols in FEATURE_GROUPS.items():
        if group == "other":
            continue
        y = x.copy()
        y[cols] = reference[cols].to_numpy()
        gains[group] = base - model.predict(y)
    g = pd.DataFrame(gains)
    best = g.idxmax(axis=1)
    return [b if v >= 0.02 else "other" for b, v in zip(best, g.max(axis=1), strict=True)]


@dataclass
class ChurnResult:
    model: Model | None
    chosen: str
    metrics: dict
    budget: pd.DataFrame
    scores: pd.DataFrame  # student_id, score, reason (active members)
    notes: list[str] = field(default_factory=list)


def _budget_table(test: pd.DataFrame, scored: np.ndarray, frame: pd.DataFrame, budget: int) -> pd.DataFrame:
    """Per week and branch: the model contacts its top `budget` among members ending in the next
    28 days (scored that day); the baseline contacts `budget` members expiring in the next 7 days,
    soonest first. Hits = contacted members who then churned. `*_ids` keep each membership once, so
    the totals count people, not weeks."""
    test = test.assign(score=scored)
    labelled = frame[frame["observable"]]
    weeks = pd.date_range(test["point"].min().normalize(), test["end_date"].max() - pd.Timedelta(days=28), freq="7D")
    out = []
    for w in weeks:
        for branch in sorted(test["branch_id"].dropna().unique()):
            pool = test[(test["branch_id"] == branch) & (test["point"] == w)]
            if pool.empty:
                continue
            pick = pool.sort_values("score", ascending=False).head(budget)
            base = (
                labelled[
                    (labelled["branch_id"] == branch) & (labelled["end_date"] >= w) & (labelled["end_date"] < w + pd.Timedelta(days=7))
                ]
                .sort_values("end_date")
                .head(budget)
            )
            out.append(
                {
                    "week": w.date(),
                    "branch_id": branch,
                    "model_contacted": len(pick),
                    "model_hits": int(pick["churned"].sum()),
                    "baseline_contacted": len(base),
                    "baseline_hits": int(base["churned"].sum()),
                    "model_hit_ids": set(pick.loc[pick["churned"] == 1, "membership_id"]),
                    "baseline_hit_ids": set(base.loc[base["churned"] == 1, "id"]),
                }
            )
    return pd.DataFrame(out)


def _weekly_pool(ds: Dataset, frame: pd.DataFrame, days: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    """Every labelled membership ending within 28 days of each test week start, scored as of that day."""
    labelled = frame[frame["observable"]]
    parts = []
    for w in pd.date_range(start, end, freq="7D"):
        sel = labelled[(labelled["end_date"] >= w) & (labelled["end_date"] < w + pd.Timedelta(days=28)) & (labelled["start_date"] <= w)]
        if sel.empty:
            continue
        point = pd.Series(w, index=sel.index)
        x = features_at(ds, sel, point, days)
        x["branch_id"], x["end_date"], x["point"], x["churned"] = sel["branch_id"], sel["end_date"], w, sel["churned"]
        x["student_id"], x["membership_id"] = sel["student_id"], sel["id"]
        parts.append(x)
    return pd.concat(parts) if parts else pd.DataFrame()


def train_and_score(ds: Dataset, budget: int = CONTACT_BUDGET, test_days: int = TEST_DAYS) -> ChurnResult:
    frame = membership_frame(ds)
    days = student_days(ds)
    rows = training_rows(ds, frame, days)
    notes: list[str] = []
    if rows.empty:
        return ChurnResult(None, "none", {}, pd.DataFrame(), pd.DataFrame(), ["No membership has a known outcome yet."])
    last_end = rows["end_date"].max()
    cut = last_end - pd.Timedelta(days=test_days)
    train, test = rows[rows["end_date"] <= cut], rows[rows["end_date"] > cut]
    if len(train) < 40 or train["churned"].nunique() < 2 or test["churned"].nunique() < 2:
        notes.append(f"Too little history for a time-based test (train {len(train)}, test {len(test)} rows); not scored.")
        return ChurnResult(None, "none", {"train_rows": len(train), "test_rows": len(test)}, pd.DataFrame(), pd.DataFrame(), notes)

    headline = test[test["offset"] == PREDICTION_DAYS]
    candidates: dict[str, Model] = {"cox": Cox(), "gradient_boosting": GBM()}
    metrics: dict = {
        "train_rows": len(train),
        "test_rows": len(test),
        "test_memberships": len(headline),
        "test_churn_rate": float(headline["churned"].mean()),
        "split_end_date": str(cut.date()),
    }
    for name, model in candidates.items():
        try:
            model.fit(train)
            metrics[f"c_index_{name}"] = float(roc_auc_score(headline["churned"], model.predict(headline)))
        except Exception as e:  # a model that cannot fit is reported, not hidden
            notes.append(f"{name} could not be fitted: {e}")
            metrics[f"c_index_{name}"] = float("nan")
    chosen = max(candidates, key=lambda n: np.nan_to_num(metrics[f"c_index_{n}"], nan=-1))
    model = candidates[chosen]

    pool = _weekly_pool(ds, frame, days, cut.normalize(), last_end - pd.Timedelta(days=28))
    budget_rows = _budget_table(pool, model.predict(pool), frame, budget) if not pool.empty else pd.DataFrame()
    if not budget_rows.empty:
        for who in ("model", "baseline"):
            contacted = budget_rows[f"{who}_contacted"].sum()
            metrics[f"{who}_hit_rate"] = float(budget_rows[f"{who}_hits"].sum() / contacted) if contacted else 0.0
            metrics[f"{who}_churners_reached"] = len(set().union(*budget_rows[f"{who}_hit_ids"]))
        metrics["beats_baseline"] = bool(metrics["model_hit_rate"] > metrics["baseline_hit_rate"])

    # Refit on everything for today's scores.
    final = {"cox": Cox, "gradient_boosting": GBM}[chosen]().fit(rows)
    today = ist_day(pd.Series([ds.as_of]))[0]
    active = frame[frame["is_active"].fillna(False).astype(bool) & (frame["end_date"] >= today)]
    active = active.sort_values("end_date").groupby("student_id").tail(1)  # an early renewal counts, not the old plan
    scores = pd.DataFrame(columns=["student_id", "score", "reason"])
    if not active.empty:
        x = features_at(ds, active, pd.Series(today, index=active.index), days)
        s = final.predict(x)
        why = reasons(final, x, rows[FEATURES].median())
        scores = pd.DataFrame(
            {
                "student_id": active["student_id"].to_numpy(),
                "score": np.round(s, 4),
                "reason": [r if v >= 0.3 else "other" for r, v in zip(why, s, strict=True)],
            }
        )
    return ChurnResult(final, chosen, metrics, budget_rows, scores, notes)


def report(result: ChurnResult, as_of: pd.Timestamp, budget: int = CONTACT_BUDGET) -> str:
    m = result.metrics
    lines = [
        f"# Churn model report — {as_of.date()}",
        "",
        f"Model version `{MODEL_VERSION}`. Label: no new membership starting within {GRACE_DAYS} days after the end date. "
        f"Prediction point: {PREDICTION_DAYS} days before the end date. Time-based split: memberships ending after "
        f"{m.get('split_end_date', '—')} are the test set.",
        "",
    ]
    if result.model is None:
        lines += ["**Not scored.**", ""] + [f"- {n}" for n in result.notes]
        return "\n".join(lines) + "\n"
    lines += [
        "## Validation (test period)",
        "",
        "| | Cox (lifelines) | Gradient boosting |",
        "|---|---|---|",
        f"| Concordance (AUC) at {PREDICTION_DAYS} days | {m['c_index_cox']:.3f} | {m['c_index_gradient_boosting']:.3f} |",
        "",
        f"Kept: **{result.chosen}**. Test memberships: {m['test_memberships']}, churn rate {m['test_churn_rate']:.0%}.",
        "",
    ]
    if "model_hit_rate" in m:
        verdict = "beats" if m["beats_baseline"] else "does **not** beat"
        lines += [
            f"## Contact budget: {budget} per branch per week",
            "",
            "| | Hit rate (contacted who then churned) | Churners reached (each once) |",
            "|---|---|---|",
            f"| Model (top {budget} of members ending in the next 28 days) | {m['model_hit_rate']:.0%} | {m['model_churners_reached']} |",
            f"| Today: everyone expiring in the next 7 days | {m['baseline_hit_rate']:.0%} | {m['baseline_churners_reached']} |",
            "",
            f"The model {verdict} the 7-day reminder at the same budget.",
            "",
        ]
    if not result.scores.empty:
        counts = result.scores["reason"].value_counts()
        lines += [
            "## Today's scores",
            "",
            f"{len(result.scores)} active members scored. Reasons: " + ", ".join(f"{k} {v}" for k, v in counts.items()) + ".",
        ]
    lines += [""] + [f"- {n}" for n in result.notes]
    return "\n".join(lines).rstrip() + "\n"
