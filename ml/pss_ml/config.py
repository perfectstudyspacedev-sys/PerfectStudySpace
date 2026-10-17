"""Constants shared by every model. Business rules match the api function."""

from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ML_DIR / "data"
OUT_DIR = ML_DIR / "out"
REPORTS_DIR = ML_DIR / "reports"
ENV_FILE = ML_DIR / ".env"

# MEMBERSHIP_GRACE_DAYS in supabase/functions/_shared/membership.ts: a renewal that starts more than
# this many days after the old end date is a "late" one; with no renewal in that window the
# membership counts as churned (P1.5).
GRACE_DAYS = 10
# P1.5: churn is predicted this many days before end_date.
PREDICTION_DAYS = 21
# Owner's weekly contact budget per branch for the churn comparison (P1.5).
CONTACT_BUDGET = 20
# The test period of the time-based split, in days before the last observable end date.
TEST_DAYS = 75

FEATURE_WINDOW_DAYS = 60  # fingerprint and engagement look back this far
FORECAST_DAYS = 60  # P1.7: income expected over the next 60 days, in weekly rows
ANOMALY_TOP_N = 5  # flags per week at most (P1.6)
ANOMALY_MIN_SCORE = 3.5  # robust z-score below which nothing is flagged

IST_OFFSET_HOURS = 5.5
MODEL_VERSION = "v1"
