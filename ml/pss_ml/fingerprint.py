"""P1.4 — Focus Fingerprint, version 1: habits over the last FEATURE_WINDOW_DAYS days, scaled, then
PCA and k-means. Each cluster gets a plain description from its centre; the owner approves or renames
the labels before they are shown anywhere."""

from __future__ import annotations

import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from .config import FEATURE_WINDOW_DAYS, MODEL_VERSION
from .data import Dataset
from .features import ist_day, student_days

HABITS = [
    "arrival_mean",
    "arrival_spread",
    "minutes_mean",
    "usage_mean",
    "visit_days_per_week",
    "weekend_share",
    "sessions_per_day",
    "food_per_visit",
    "focus_mean",
]
DESCRIBE = {  # habit -> (word when high, word when low)
    "arrival_mean": ("late arrival", "early arrival"),
    "minutes_mean": ("long days", "short days"),
    "usage_mean": ("uses booked hours", "leaves early"),
    "visit_days_per_week": ("comes most days", "comes now and then"),
    "weekend_share": ("weekend regular", "weekdays only"),
    "focus_mean": ("high focus", "low focus"),
}


def habits(ds: Dataset, days: pd.DataFrame | None = None) -> pd.DataFrame:
    days = student_days(ds) if days is None else days
    today = ist_day(pd.Series([ds.as_of]))[0]
    recent = days[(today - days["day"]).dt.days.between(1, FEATURE_WINDOW_DAYS)]
    g = recent.groupby("student_id")
    h = pd.DataFrame(
        {
            "arrival_mean": g["arrival_minute"].mean(),
            "arrival_spread": g["arrival_minute"].std().fillna(0),
            "minutes_mean": g["minutes_used"].mean(),
            "usage_mean": g["usage_ratio"].mean(),
            "visit_days_per_week": g.size() / (FEATURE_WINDOW_DAYS / 7),
            "weekend_share": g["weekend"].mean(),
            "sessions_per_day": g["sessions"].mean(),
            "food_per_visit": g["food_spend"].mean(),
            "focus_mean": g["focus"].mean(),
        }
    )
    return h[HABITS]


def active_students(ds: Dataset) -> set[str]:
    today = ist_day(pd.Series([ds.as_of]))[0]
    m = ds["memberships"]
    return set(m[m["is_active"].fillna(False).astype(bool) & (m["end_date"] >= today)]["student_id"])


def fingerprints(ds: Dataset, k: int | None = None, days: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(rows for the fingerprints table, cluster summary). Every active member gets a row; one with no
    visits in the window gets cluster 'new or away' and no vector."""
    h = habits(ds, days)
    active = active_students(ds)
    h = h[h.index.isin(active)]
    rows, summary = [], pd.DataFrame()
    if len(h) >= 6:
        filled = h.fillna(h.median()).fillna(0)
        z = StandardScaler().fit_transform(filled)
        pca = PCA(n_components=min(3, z.shape[1]), random_state=0).fit(z)
        coords = pca.transform(z)
        ks = [k] if k else [c for c in range(3, 7) if c < len(h)]
        best = max(ks, key=lambda c: silhouette_score(coords, KMeans(c, n_init=10, random_state=0).fit_predict(coords)))
        labels = KMeans(best, n_init=10, random_state=0).fit_predict(coords)
        centres = pd.DataFrame(z, index=h.index, columns=HABITS).groupby(labels).mean()
        names = {c: _describe(centres.loc[c], c) for c in centres.index}
        for sid, lab, vec in zip(h.index, labels, coords, strict=True):
            rows.append({"student_id": sid, "version": MODEL_VERSION, "vector": [round(float(v), 4) for v in vec], "cluster": names[lab]})
        summary = pd.DataFrame(
            {"cluster": [names[c] for c in centres.index], "members": pd.Series(labels).value_counts().sort_index().to_numpy()}
        )
    for sid in sorted(active - {r["student_id"] for r in rows}):
        rows.append({"student_id": sid, "version": MODEL_VERSION, "vector": None, "cluster": "new or away"})
    return pd.DataFrame(rows), summary


def _describe(centre: pd.Series, idx: int) -> str:
    words = [DESCRIBE[f][0 if centre[f] > 0 else 1] for f in centre.abs().sort_values(ascending=False).index if f in DESCRIBE][:2]
    return f"C{idx + 1} · " + ", ".join(words)
