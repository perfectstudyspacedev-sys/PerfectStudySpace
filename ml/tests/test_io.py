import json
import urllib.parse

import pandas as pd

from pss_ml import export, publish
from pss_ml.data import PERSONAL, TABLES, load, personal_columns
from pss_ml.supabase_io import PAGE_SIZE, Supabase


class FakeTransport:
    def __init__(self, rows_per_table=None):
        self.calls = []
        self.rows = rows_per_table or {}

    def __call__(self, req):
        url = urllib.parse.urlparse(req.full_url)
        table = url.path.rsplit("/", 1)[-1]
        q = dict(urllib.parse.parse_qsl(url.query))
        self.calls.append(
            {
                "method": req.get_method(),
                "table": table,
                "query": q,
                "headers": dict(req.header_items()),
                "body": json.loads(req.data) if req.data else None,
            }
        )
        if req.get_method() == "GET":
            rows = self.rows.get(table, [])
            off, lim = int(q["offset"]), int(q["limit"])
            return 200, json.dumps(rows[off : off + lim]).encode()
        return 201, b""


def test_export_pages_past_the_1000_row_cap_and_keeps_personal_data_out(tmp_path):
    bookings = [{c: None for c in TABLES["bookings"]} | {"id": f"b{i}", "booking_type": "temporary"} for i in range(2500)]
    t = FakeTransport({"bookings": bookings})
    counts = export.export(Supabase("https://x.supabase.co", "key", t), tmp_path, pd.Timestamp("2026-10-16T05:30Z"))
    assert counts["bookings"] == 2500 and len([c for c in t.calls if c["table"] == "bookings"]) == 3
    assert PAGE_SIZE == 1000
    for c in t.calls:
        assert not personal_columns(c["table"]) & set(c["query"]["select"].split(","))
        assert c["headers"]["Authorization"] == "Bearer key"
    students = next(c for c in t.calls if c["table"] == "students")
    assert students["query"]["select"] == "id,branch_id,status,created_at"
    ev = next(c for c in t.calls if c["table"] == "events")
    assert ev["query"]["action"] == "in.(add_attendance,update_attendance,set_overtime_excluded)" and ev["query"]["ok"] == "eq.true"
    ds = load(tmp_path)
    assert len(ds["bookings"]) == 2500 and str(ds.as_of) == "2026-10-16 05:30:00+00:00"


def test_publish_writes_each_table_the_safe_way(synthetic):
    from pss_ml import cli

    rows, summary = cli.run(
        synthetic, 8, {"C2 · high focus, comes most days": "Steady regulars"}, __import__("pathlib").Path("/tmp/pss-ml-test")
    )
    for table, data in rows.items():
        for r in data:
            assert not (PERSONAL | {"name", "display_name"}) & set(r), table
    assert any(r["cluster"] == "Steady regulars" for r in rows["fingerprints"])
    t = FakeTransport()
    counts = publish.publish(rows, Supabase("https://x.supabase.co", "key", t), summary["today"])
    calls = [(c["method"], c["table"], c["query"].get("on_conflict"), c["headers"].get("Prefer")) for c in t.calls]
    assert ("POST", "student_scores", "student_id,model", "resolution=merge-duplicates,return=minimal") in calls
    assert ("POST", "student_score_history", None, "return=minimal") in calls
    assert ("POST", "fingerprints", "student_id", "resolution=merge-duplicates,return=minimal") in calls
    assert ("POST", "anomaly_flags", "kind,ref_table,ref_id", "resolution=ignore-duplicates,return=minimal") in calls
    delete = next(c for c in t.calls if c["method"] == "DELETE")
    assert delete["table"] == "forecasts" and delete["query"] == {"kind": "eq.cash_inflow", "period_start": "gte.2026-10-16"}
    assert counts["forecasts"] == 9 and counts["anomaly_flags"] == 6
    assert all(r["status"] == "open" for r in rows["anomaly_flags"])


def test_dry_run_writes_files_only(tmp_path, synthetic):
    rows = publish.build(pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), synthetic.as_of)
    counts = publish.publish(rows, None, "2026-10-16", dry_run=True, out_dir=tmp_path)
    assert counts == {"student_scores": 0, "fingerprints": 0, "anomaly_flags": 0, "forecasts": 0}
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "anomaly_flags.json",
        "fingerprints.json",
        "forecasts.json",
        "student_scores.json",
    ]
