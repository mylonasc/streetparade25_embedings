from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4

from .config import default_db_path

_configured_db_path: Path | None = None


def get_database_path() -> Path:
    return _configured_db_path or default_db_path()


def set_database_path(path: str | Path) -> Path:
    global _configured_db_path
    resolved = Path(path).expanduser()
    _configured_db_path = resolved
    init_annotation_db()
    return resolved


def connect() -> sqlite3.Connection:
    path = get_database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_annotation_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS annotation_campaign (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS annotation_label_sets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                annotation_campaign_id INTEGER NOT NULL REFERENCES annotation_campaign(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(annotation_campaign_id, name)
            );

            CREATE TABLE IF NOT EXISTS annotation_labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                label_set_id INTEGER NOT NULL REFERENCES annotation_label_sets(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                color TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(label_set_id, name)
            );

            CREATE TABLE IF NOT EXISTS annotation_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                annotation_campaign_id INTEGER NOT NULL REFERENCES annotation_campaign(id) ON DELETE CASCADE,
                track_id INTEGER NOT NULL,
                track_sample_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(annotation_campaign_id, track_sample_id)
            );

            CREATE TABLE IF NOT EXISTS annotation_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                annotation_campaign_id INTEGER NOT NULL REFERENCES annotation_campaign(id) ON DELETE CASCADE,
                track_id INTEGER NOT NULL,
                track_sample_id INTEGER NOT NULL,
                label_set_id INTEGER NOT NULL REFERENCES annotation_label_sets(id) ON DELETE CASCADE,
                label_id INTEGER NOT NULL REFERENCES annotation_labels(id) ON DELETE CASCADE,
                annotator TEXT,
                confidence REAL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(annotation_campaign_id, track_sample_id, label_id)
            );
            """
        )
        _ensure_source_metadata_columns(conn)
        _ensure_sample_embeddings_table(conn)


def _ensure_source_metadata_columns(conn: sqlite3.Connection) -> None:
    tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "artists" in tables:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(artists)")}
        for column in ("soundcloud_url", "instagram", "youtube", "web"):
            if column not in columns:
                conn.execute(f"ALTER TABLE artists ADD COLUMN {column} TEXT")


def _ensure_sample_embeddings_table(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sample_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            vector_id TEXT NOT NULL UNIQUE,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            track_sample_id INTEGER NOT NULL REFERENCES track_samples(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            start_seconds REAL NOT NULL,
            duration_seconds REAL NOT NULL,
            embedding_backend TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedding_model_config TEXT NOT NULL,
            embedding_model_config_hash TEXT NOT NULL,
            sampling_strategy TEXT NOT NULL,
            sampling_strategy_hash TEXT NOT NULL,
            pipeline_config TEXT NOT NULL,
            embedding_dim INTEGER NOT NULL,
            embedded_at TEXT NOT NULL,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(track_sample_id, embedding_backend, embedding_model, embedding_model_config_hash, sampling_strategy_hash)
        );
        """
    )


def new_uuid() -> str:
    return uuid4().hex
