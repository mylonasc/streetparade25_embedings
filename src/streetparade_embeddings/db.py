from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from uuid import uuid4


def db_path() -> Path:
    return Path(os.environ.get("STREETPARADE_DB", "streetparade_embeddings.sqlite3"))


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS artists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE,
                name TEXT NOT NULL UNIQUE,
                links TEXT NOT NULL DEFAULT '[]',
                images TEXT NOT NULL DEFAULT '[]',
                info TEXT NOT NULL DEFAULT '[]',
                socials TEXT NOT NULL DEFAULT '[]',
                bio TEXT,
                soundcloud_url TEXT,
                instagram TEXT,
                youtube TEXT,
                web TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE,
                artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                path TEXT,
                downloaded INTEGER NOT NULL DEFAULT 0,
                download_status TEXT NOT NULL DEFAULT 'not_started',
                sample_count INTEGER NOT NULL DEFAULT 0,
                sampling_rate INTEGER,
                chunk_seconds INTEGER,
                chunk_stride_seconds INTEGER,
                max_chunks INTEGER,
                embedding BLOB,
                embedding_dim INTEGER,
                embedding_model TEXT,
                embedded_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(artist_id, url)
            );

            CREATE TABLE IF NOT EXISTS track_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                start_seconds REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                UNIQUE(track_id, chunk_index)
            );

            CREATE TABLE IF NOT EXISTS track_embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                vector_id TEXT NOT NULL UNIQUE,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
                artist_uuid TEXT NOT NULL,
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
                UNIQUE(track_id, embedding_backend, embedding_model, embedding_model_config_hash, sampling_strategy_hash)
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                source_url TEXT NOT NULL,
                source_type TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                status TEXT NOT NULL DEFAULT 'queued',
                track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
                vector_id TEXT,
                x REAL,
                y REAL,
                placement_method TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, source_url)
            );

            CREATE TABLE IF NOT EXISTS user_track_jobs (
                id TEXT PRIMARY KEY,
                user_track_id INTEGER NOT NULL REFERENCES user_tracks(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                phase TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT
            );

            CREATE TABLE IF NOT EXISTS embedding_layouts (
                id TEXT PRIMARY KEY,
                username TEXT,
                status TEXT NOT NULL,
                points_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT
            );

            CREATE TABLE IF NOT EXISTS preference_shares (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS preference_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                username TEXT NOT NULL,
                point_id TEXT NOT NULL,
                target_kind TEXT NOT NULL,
                target_id TEXT NOT NULL,
                track_id INTEGER,
                user_track_id INTEGER,
                vector_id TEXT,
                value TEXT NOT NULL CHECK(value IN ('up', 'down', 'clear')),
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS preference_events_user_target_idx
                ON preference_events(user_id, target_kind, target_id, id);
            """
        )
        ensure_artist_columns(conn)
        ensure_track_columns(conn)
        ensure_sample_embedding_table(conn)
        ensure_uuid_indexes(conn)
        ensure_entity_uuids(conn)


def ensure_artist_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(artists)")}
    migrations = {
        "uuid": "ALTER TABLE artists ADD COLUMN uuid TEXT",
        "links": "ALTER TABLE artists ADD COLUMN links TEXT NOT NULL DEFAULT '[]'",
        "images": "ALTER TABLE artists ADD COLUMN images TEXT NOT NULL DEFAULT '[]'",
        "info": "ALTER TABLE artists ADD COLUMN info TEXT NOT NULL DEFAULT '[]'",
        "socials": "ALTER TABLE artists ADD COLUMN socials TEXT NOT NULL DEFAULT '[]'",
        "bio": "ALTER TABLE artists ADD COLUMN bio TEXT",
        "instagram": "ALTER TABLE artists ADD COLUMN instagram TEXT",
        "youtube": "ALTER TABLE artists ADD COLUMN youtube TEXT",
        "web": "ALTER TABLE artists ADD COLUMN web TEXT",
    }
    for column, statement in migrations.items():
        if column not in columns:
            conn.execute(statement)


def ensure_track_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(tracks)")}
    if "download_status" not in columns:
        conn.execute("ALTER TABLE tracks ADD COLUMN download_status TEXT NOT NULL DEFAULT 'not_started'")
        conn.execute("UPDATE tracks SET download_status = 'completed' WHERE downloaded = 1")
    if "uuid" not in columns:
        conn.execute("ALTER TABLE tracks ADD COLUMN uuid TEXT")


def ensure_sample_embedding_table(conn: sqlite3.Connection) -> None:
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


def ensure_uuid_indexes(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS artists_uuid_unique ON artists(uuid) WHERE uuid IS NOT NULL")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS tracks_uuid_unique ON tracks(uuid) WHERE uuid IS NOT NULL")


def ensure_entity_uuids(conn: sqlite3.Connection) -> None:
    for table in ("artists", "tracks"):
        rows = conn.execute(f"SELECT id FROM {table} WHERE uuid IS NULL OR uuid = ''").fetchall()
        for row in rows:
            conn.execute(f"UPDATE {table} SET uuid = ? WHERE id = ?", (uuid4().hex, row["id"]))
