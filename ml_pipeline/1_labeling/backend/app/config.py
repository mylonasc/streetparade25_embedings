from __future__ import annotations

import os
from pathlib import Path


def default_db_path() -> Path:
    """Return the annotation backend's default SQLite database path."""
    return Path(os.environ.get("STREETPARADE_DB", "streetparade_embeddings.sqlite3"))


def cors_origins() -> list[str]:
    """Return allowed CORS origins for the annotation API."""
    raw = os.environ.get(
        "ANNOTATION_CORS_ORIGINS",
        "http://localhost:3100,http://localhost:5175,http://127.0.0.1:3100,http://127.0.0.1:5175",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
