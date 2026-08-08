"""Decoupled data-access layer for the preference dashboard.

A single :class:`DataBackend` interface hides where the data comes from. Two
implementations ship today:

- :class:`SqliteBackend` — read-only connection to a ``streetparade_embeddings.sqlite3``
  file (prod snapshot or live PVC path).
- :class:`HttpBackend` — reads the same user-summary shape from a remote API
  (future snapshot API or a running backend server).

The dashboard server only ever talks to a ``DataBackend``; swap the backend by
changing the constructor, not the rest of the app.
"""

import json
import sqlite3
import urllib.request
from dataclasses import dataclass
from typing import Protocol

USER_SUMMARY_QUERY = """
SELECT u.username,
       COALESCE(SUM(CASE WHEN p.value = 'up' THEN 1 ELSE 0 END), 0) AS up,
       COALESCE(SUM(CASE WHEN p.value = 'down' THEN 1 ELSE 0 END), 0) AS down,
       COALESCE(SUM(CASE WHEN p.value = 'clear' THEN 1 ELSE 0 END), 0) AS cleared
FROM users u
LEFT JOIN user_preferences p ON p.user_id = u.id
GROUP BY u.id, u.username
ORDER BY up DESC, u.username ASC
"""


@dataclass(frozen=True)
class UserSummary:
    """One row of the preferences table: a user and their counts."""

    username: str
    up: int
    down: int
    cleared: int

    def as_dict(self) -> dict[str, object]:
        return {
            "username": self.username,
            "up": self.up,
            "down": self.down,
            "cleared": self.cleared,
        }


class DataBackend(Protocol):
    """Contract every backend must satisfy."""

    def list_user_summaries(self) -> list[UserSummary]:
        """Return one summary per user, including users with no preferences."""

    def describe(self) -> str:
        """Human-readable backend description for the health endpoint."""

    def close(self) -> None:
        """Release any held resources (no-op for stateless backends)."""


class SqliteBackend:
    """Read-only SQLite backend.

    Opens the DB with ``mode=ro`` so it can never mutate the file, and runs a
    single aggregate query that outer-joins ``user_preferences`` so users with
    zero preferences still appear with zero counts.
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.connection = sqlite3.connect(
            f"file:{db_path}?mode=ro",
            uri=True,
            check_same_thread=False,
        )
        self.connection.row_factory = sqlite3.Row

    def list_user_summaries(self) -> list[UserSummary]:
        rows = self.connection.execute(USER_SUMMARY_QUERY).fetchall()
        return [
            UserSummary(
                username=row["username"],
                up=int(row["up"]),
                down=int(row["down"]),
                cleared=int(row["cleared"]),
            )
            for row in rows
        ]

    def describe(self) -> str:
        return f"sqlite (read-only): {self.db_path}"

    def close(self) -> None:
        self.connection.close()


class HttpBackend:
    """Remote API backend.

    Fetches the same ``{"users": [...]}`` payload the dashboard serves itself
    from ``<api_base><users_path>``, so any service that speaks that shape can
    be swapped in. ``api_base`` may be a bare host:port or a full base URL with
    a path prefix.
    """

    def __init__(self, api_base: str, users_path: str = "/users") -> None:
        self.api_base = api_base.rstrip("/")
        self.users_path = users_path if users_path.startswith("/") else f"/{users_path}"

    def list_user_summaries(self) -> list[UserSummary]:
        url = f"{self.api_base}{self.users_path}"
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        users = payload.get("users", payload if isinstance(payload, list) else [])
        return [
            UserSummary(
                username=str(item["username"]),
                up=int(item.get("up", 0)),
                down=int(item.get("down", 0)),
                cleared=int(item.get("cleared", 0)),
            )
            for item in users
        ]

    def describe(self) -> str:
        return f"http: {self.api_base}{self.users_path}"

    def close(self) -> None:
        return None


def build_backend(
    backend: str,
    db_path: str | None = None,
    api_base: str | None = None,
    users_path: str = "/users",
) -> DataBackend:
    """Create a backend from a name and its configuration."""
    if backend == "sqlite":
        if not db_path:
            raise ValueError("--db is required for the sqlite backend")
        return SqliteBackend(db_path)
    if backend == "http":
        if not api_base:
            raise ValueError("--api-base is required for the http backend")
        return HttpBackend(api_base, users_path)
    raise ValueError(f"unknown backend: {backend!r}")
