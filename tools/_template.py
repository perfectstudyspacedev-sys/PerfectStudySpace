#!/usr/bin/env python3
"""One-line description of what this tool does.

Inputs:  --example-id  the thing to process
Outputs: JSON to stdout
COST:    free  (or: ~$0.02 per run, <provider>)
"""

import argparse
import json
import os
import sys


def run(example_id: str) -> dict:
    """Do the actual work. Keep this deterministic."""
    api_key = os.environ.get("EXAMPLE_API_KEY")
    if not api_key:
        raise RuntimeError("EXAMPLE_API_KEY not set in .env")

    return {"example_id": example_id, "status": "ok"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--example-id", required=True)
    args = parser.parse_args()

    try:
        result = run(args.example_id)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
