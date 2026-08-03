from __future__ import annotations

from datetime import UTC, datetime


def now() -> str:
    """Return the current UTC timestamp in ISO-8601 format."""
    return datetime.now(UTC).isoformat()
