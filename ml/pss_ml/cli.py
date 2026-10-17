"""Command line: `uv run pss-ml export`, `uv run pss-ml run [--synthetic] [--publish]`.

run: churn (P1.5, report in ml/reports/), fingerprints (P1.4, cluster list for the owner to label),
anomaly flags (P1.6), forecast and engagement (P1.7). Without --publish the rows go to ml/out/ only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from . import anomaly, churn, data, export, fingerprint, forecast, publish
from .config import CONTACT_BUDGET, DATA_DIR, OUT_DIR, REPORTS_DIR
from .features import ist_day, student_days
from .supabase_io import Supabase


def run(ds: data.Dataset, budget: int, labels: dict[str, str] | None, report_dir: Path) -> tuple[dict, dict]:
    days = student_days(ds)
    c = churn.train_and_score(ds, budget=budget)
    report_dir.mkdir(parents=True, exist_ok=True)
    today = ist_day(pd.Series([ds.as_of]))[0].date()
    (report_dir / f"churn-{today}.md").write_text(churn.report(c, ds.as_of, budget))
    prints, clusters = fingerprint.fingerprints(ds, days=days)
    (report_dir / f"clusters-{today}.md").write_text(
        "# Focus Fingerprint clusters — for the owner to approve or rename\n\n"
        + ("\n".join(f"- {r.cluster}: {r.members} members" for r in clusters.itertuples()) or "- (not enough members yet)")
        + '\n\nRename with a JSON file {"<cluster as above>": "<your label>"} passed as --labels.\n'
    )
    flags = anomaly.detect(ds)
    fc = forecast.forecast(ds, c.scores)
    eng = forecast.engagement(ds, c.scores, days)
    rows = publish.build(c.scores, eng.drop(columns=["version"]), prints, flags, fc, ds.as_of, labels)
    summary = {
        "churn_model": c.chosen,
        "churn_metrics": c.metrics,
        "notes": c.notes,
        "clusters": clusters.to_dict("records"),
        "flags": len(flags),
        "today": str(today),
    }
    return rows, summary


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="pss-ml")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("export", help="download the tables the models need to ml/data/")
    r = sub.add_parser("run", help="train, score and (with --publish) write results to Supabase")
    r.add_argument("--synthetic", action="store_true", help="use made-up data (no Supabase needed)")
    r.add_argument("--budget", type=int, default=CONTACT_BUDGET, help="contacts per branch per week")
    r.add_argument("--labels", type=Path, help="JSON file mapping cluster names to the owner's labels")
    r.add_argument("--publish", action="store_true", help="write results to Supabase (needs ml/.env)")
    args = p.parse_args(argv)

    if args.cmd == "export":
        counts = export.export(Supabase.from_env(), DATA_DIR)
        print(json.dumps(counts, indent=1))
        return
    if args.synthetic:
        from .synthetic import generate

        ds, report_dir = generate(), OUT_DIR / "synthetic"
        if args.publish:
            raise SystemExit("--publish is refused with --synthetic")
    else:
        ds, report_dir = data.load(DATA_DIR), REPORTS_DIR
    labels = json.loads(args.labels.read_text()) if args.labels else None
    rows, summary = run(ds, args.budget, labels, report_dir)
    counts = publish.publish(
        rows,
        Supabase.from_env() if args.publish else None,
        summary["today"],
        dry_run=not args.publish,
        out_dir=OUT_DIR / ("synthetic" if args.synthetic else "latest"),
    )
    print(json.dumps({**summary, "rows": counts, "published": bool(args.publish)}, indent=1, default=str))


if __name__ == "__main__":
    main()
