"""Minimal PostgREST client for the export and publish steps (standard library only).

Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from ml/.env or the environment. The service key
bypasses RLS, so this file is the only place it is used, and it is never logged.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable

from .config import ENV_FILE

PAGE_SIZE = 1000  # Supabase returns at most 1,000 rows per request by default


def load_env(path=ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if os.environ.get(key):
            values[key] = os.environ[key]
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not values.get(k)]
    if missing:
        raise SystemExit(f"Missing {', '.join(missing)} — copy ml/env.example to ml/.env and fill it in")
    return values


Transport = Callable[[urllib.request.Request], tuple[int, bytes]]


def _default_transport(req: urllib.request.Request) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(req, timeout=120) as res:  # noqa: S310 (URL comes from ml/.env)
            return res.status, res.read()
    except urllib.error.HTTPError as e:  # keep PostgREST's error text (it never contains the key)
        return e.code, e.read()


class Supabase:
    def __init__(self, url: str, key: str, transport: Transport = _default_transport):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = key
        self.transport = transport

    @classmethod
    def from_env(cls) -> Supabase:
        env = load_env()
        return cls(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

    def _request(self, method: str, table: str, params: dict[str, str], body=None, headers=None):
        query = urllib.parse.urlencode(params)
        req = urllib.request.Request(
            self.base + table + (f"?{query}" if query else ""),
            method=method,
            data=None if body is None else json.dumps(body, default=str).encode(),
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                **(headers or {}),
            },
        )
        status, raw = self.transport(req)
        if status >= 300:
            raise RuntimeError(f"{method} {table} failed with HTTP {status}: {raw[:300]!r}")
        return json.loads(raw) if raw else None

    def select_all(self, table: str, columns: Iterable[str], filters: dict[str, str] | None = None, key: str = "id") -> list[dict]:
        """Every row of `table`, a page at a time, paged by key (`key > last seen`) rather than by
        offset, so rows added or removed while it runs cannot shift the pages; stops on an empty
        page, so a server row cap below PAGE_SIZE cannot cut it short."""
        cols = list(columns)
        if key not in cols:
            raise ValueError(f"{table}: the paging key {key} must be selected")
        rows: list[dict] = []
        while True:
            params = {"select": ",".join(cols), "order": f"{key}.asc", "limit": str(PAGE_SIZE)}
            params.update(filters or {})
            if rows:
                params[key] = f"gt.{rows[-1][key]}"
            page = self._request("GET", table, params)
            if not page:
                return rows
            rows.extend(page)

    def upsert(self, table: str, rows: list[dict], on_conflict: str, ignore_duplicates: bool = False) -> None:
        resolution = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        for start in range(0, len(rows), 500):
            self._request(
                "POST",
                table,
                {"on_conflict": on_conflict},
                rows[start : start + 500],
                {"Prefer": f"resolution={resolution},return=minimal"},
            )

    def insert(self, table: str, rows: list[dict]) -> None:
        for start in range(0, len(rows), 500):
            self._request("POST", table, {}, rows[start : start + 500], {"Prefer": "return=minimal"})

    def delete(self, table: str, filters: dict[str, str]) -> None:
        if not filters:
            raise ValueError("refusing to delete without a filter")
        self._request("DELETE", table, filters, headers={"Prefer": "return=minimal"})
