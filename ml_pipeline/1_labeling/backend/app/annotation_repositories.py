from __future__ import annotations

import sqlite3
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import HTTPException

from .db import connect, get_database_path, init_annotation_db, new_uuid


def now() -> str:
    """Return the current UTC timestamp in ISO-8601 format."""
    return datetime.now(UTC).isoformat()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    """Convert an optional SQLite row to a dictionary."""
    return dict(row) if row is not None else None


def _require(row: sqlite3.Row | None, detail: str) -> sqlite3.Row:
    if row is None:
        raise HTTPException(status_code=404, detail=detail)
    return row


def create_annotation_campaign(name: str, description: str | None, status: str = "active") -> dict[str, Any]:
    """Create or update an annotation campaign by name.

    Args:
        name: Unique campaign name.
        description: Optional human-readable campaign description.
        status: Campaign status string.

    Returns:
        Stored campaign row.
    """
    init_annotation_db()
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO annotation_campaign (uuid, name, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (new_uuid(), name, description, status, timestamp, timestamp),
        )
        return dict(conn.execute("SELECT * FROM annotation_campaign WHERE name = ?", (name,)).fetchone())


def list_annotation_campaigns() -> list[dict[str, Any]]:
    """List annotation campaigns ordered by most recently updated."""
    init_annotation_db()
    with connect() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM annotation_campaign ORDER BY updated_at DESC, id DESC")]


def get_annotation_campaign(campaign_id: int, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Load one annotation campaign.

    Args:
        campaign_id: Campaign primary key.
        conn: Optional existing database connection.

    Returns:
        Campaign row as a dictionary.

    Raises:
        HTTPException: If the campaign does not exist.
    """
    if conn is not None:
        return dict(_require(conn.execute("SELECT * FROM annotation_campaign WHERE id = ?", (campaign_id,)).fetchone(), "annotation_campaign not found"))
    init_annotation_db()
    with connect() as owned_conn:
        return get_annotation_campaign(campaign_id, owned_conn)


def create_label_set(campaign_id: int, name: str, description: str | None, sort_order: int = 0) -> dict[str, Any]:
    """Create or update a label set within a campaign."""
    init_annotation_db()
    timestamp = now()
    with connect() as conn:
        get_annotation_campaign(campaign_id, conn)
        conn.execute(
            """
            INSERT INTO annotation_label_sets (uuid, annotation_campaign_id, name, description, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(annotation_campaign_id, name) DO UPDATE SET
                description = excluded.description,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at
            """,
            (new_uuid(), campaign_id, name, description, sort_order, timestamp, timestamp),
        )
        return dict(
            conn.execute(
                "SELECT * FROM annotation_label_sets WHERE annotation_campaign_id = ? AND name = ?",
                (campaign_id, name),
            ).fetchone()
        )


def list_label_sets(campaign_id: int) -> list[dict[str, Any]]:
    """List label sets for a campaign ordered by sort order and name."""
    init_annotation_db()
    with connect() as conn:
        get_annotation_campaign(campaign_id, conn)
        return [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM annotation_label_sets WHERE annotation_campaign_id = ? ORDER BY sort_order, name",
                (campaign_id,),
            )
        ]


def create_label(
    label_set_id: int,
    name: str,
    description: str | None,
    color: str | None,
    sort_order: int = 0,
    is_active: bool = True,
) -> dict[str, Any]:
    """Create or update a label in a label set.

    Returns:
        Stored label row with ``is_active`` normalized to ``bool``.
    """
    init_annotation_db()
    timestamp = now()
    with connect() as conn:
        _require(conn.execute("SELECT * FROM annotation_label_sets WHERE id = ?", (label_set_id,)).fetchone(), "label set not found")
        conn.execute(
            """
            INSERT INTO annotation_labels (uuid, label_set_id, name, description, color, sort_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(label_set_id, name) DO UPDATE SET
                description = excluded.description,
                color = excluded.color,
                sort_order = excluded.sort_order,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
            """,
            (new_uuid(), label_set_id, name, description, color, sort_order, int(is_active), timestamp, timestamp),
        )
        row = conn.execute("SELECT * FROM annotation_labels WHERE label_set_id = ? AND name = ?", (label_set_id, name)).fetchone()
        result = dict(row)
        result["is_active"] = bool(result["is_active"])
        return result


def list_labels(label_set_id: int) -> list[dict[str, Any]]:
    """List labels in a label set ordered by sort order and name."""
    init_annotation_db()
    with connect() as conn:
        _require(conn.execute("SELECT * FROM annotation_label_sets WHERE id = ?", (label_set_id,)).fetchone(), "label set not found")
        labels = [dict(row) for row in conn.execute("SELECT * FROM annotation_labels WHERE label_set_id = ? ORDER BY sort_order, name", (label_set_id,))]
    for label in labels:
        label["is_active"] = bool(label["is_active"])
    return labels


def add_campaign_items(campaign_id: int, track_ids: list[int], track_sample_ids: list[int]) -> list[dict[str, Any]]:
    """Add track samples to an annotation campaign.

    Args:
        campaign_id: Campaign primary key.
        track_ids: Track IDs whose samples should be added.
        track_sample_ids: Individual sample IDs to add.

    Returns:
        Updated campaign item list.
    """
    init_annotation_db()
    timestamp = now()
    with connect() as conn:
        get_annotation_campaign(campaign_id, conn)
        sample_rows = _sample_rows(conn, track_ids, track_sample_ids)
        for row in sample_rows:
            conn.execute(
                """
                INSERT INTO annotation_items (uuid, annotation_campaign_id, track_id, track_sample_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(annotation_campaign_id, track_sample_id) DO UPDATE SET updated_at = excluded.updated_at
                """,
                (new_uuid(), campaign_id, row["track_id"], row["id"], timestamp, timestamp),
            )
        return list_campaign_items(campaign_id, conn)


def _sample_rows(conn: sqlite3.Connection, track_ids: list[int], track_sample_ids: list[int]) -> list[sqlite3.Row]:
    clauses = []
    params: list[Any] = []
    if track_ids:
        clauses.append(f"track_id IN ({','.join('?' for _ in track_ids)})")
        params.extend(track_ids)
    if track_sample_ids:
        clauses.append(f"id IN ({','.join('?' for _ in track_sample_ids)})")
        params.extend(track_sample_ids)
    if not clauses:
        raise HTTPException(status_code=400, detail="provide track_ids or track_sample_ids")
    return conn.execute(
        f"SELECT id, track_id, chunk_index, start_seconds, duration_seconds FROM track_samples WHERE {' OR '.join(clauses)} ORDER BY track_id, chunk_index",
        params,
    ).fetchall()


def list_campaign_items(campaign_id: int, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """List annotated samples and joined track/artist metadata for a campaign."""
    query = """
        SELECT
            ai.*,
            ts.chunk_index,
            ts.start_seconds,
            ts.duration_seconds,
            ts.start_seconds + ts.duration_seconds AS end_seconds,
            tracks.url AS track_url,
            tracks.path AS track_path,
            artists.id AS artist_id,
            artists.name AS artist_name,
            artists.soundcloud_url AS artist_soundcloud_url,
            artists.instagram AS artist_instagram,
            artists.youtube AS artist_youtube,
            artists.web AS artist_web
        FROM annotation_items ai
        JOIN track_samples ts ON ts.id = ai.track_sample_id
        JOIN tracks ON tracks.id = ai.track_id
        LEFT JOIN artists ON artists.id = tracks.artist_id
        WHERE ai.annotation_campaign_id = ?
        ORDER BY ai.track_id, ts.chunk_index
    """
    if conn is not None:
        get_annotation_campaign(campaign_id, conn)
        return [_campaign_item_response(row) for row in conn.execute(query, (campaign_id,))]
    init_annotation_db()
    with connect() as owned_conn:
        return list_campaign_items(campaign_id, owned_conn)


def list_campaign_samples(campaign_id: int) -> list[dict[str, Any]]:
    """List campaign samples with assignment data attached."""
    items = list_campaign_items(campaign_id)
    assignments = list_assignments(campaign_id)
    by_sample: dict[int, list[dict[str, Any]]] = {}
    for assignment in assignments:
        by_sample.setdefault(int(assignment["track_sample_id"]), []).append(assignment)
    for item in items:
        item["sound_segment_id"] = item["track_sample_id"]
        item["start_time"] = item["start_seconds"]
        item["end_time"] = item["end_seconds"]
        item["assignments"] = by_sample.get(int(item["track_sample_id"]), [])
    return items


def _campaign_item_response(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["track_title"] = track_title(item.get("track_url"), item.get("track_path"))
    item["artist_url"] = item.get("artist_soundcloud_url") or item.get("artist_web") or item.get("artist_youtube") or item.get("artist_instagram")
    return item


def track_title(track_url: str | None, track_path: str | None) -> str:
    """Infer a display title from a track URL or cache path."""
    if track_url:
        slug = urlparse(track_url).path.rstrip("/").split("/")[-1]
        if slug:
            return unquote(slug).replace("-", " ").replace("_", " ").title()
    if track_path:
        return Path(track_path).stem.replace("-", " ").replace("_", " ").title()
    return "Untitled Track"


def remove_campaign_item(campaign_id: int, item_id: int) -> dict[str, Any]:
    """Remove a sample from a campaign and delete its assignments."""
    init_annotation_db()
    with connect() as conn:
        get_annotation_campaign(campaign_id, conn)
        row = _require(
            conn.execute(
                "SELECT * FROM annotation_items WHERE id = ? AND annotation_campaign_id = ?",
                (item_id, campaign_id),
            ).fetchone(),
            "campaign item not found",
        )
        conn.execute(
            "DELETE FROM annotation_assignments WHERE annotation_campaign_id = ? AND track_sample_id = ?",
            (campaign_id, row["track_sample_id"]),
        )
        conn.execute("DELETE FROM annotation_items WHERE id = ?", (item_id,))
        return dict(row)


def assign_label(
    campaign_id: int,
    track_sample_id: int,
    label_id: int,
    annotator: str | None = None,
    confidence: float | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Assign a label to a track sample within a campaign.

    Existing assignments for the same campaign, sample, and label are updated.
    The sample is added to the campaign automatically if needed.
    """
    init_annotation_db()
    timestamp = now()
    with connect() as conn:
        get_annotation_campaign(campaign_id, conn)
        sample = _require(conn.execute("SELECT * FROM track_samples WHERE id = ?", (track_sample_id,)).fetchone(), "track sample not found")
        label = _require(
            conn.execute(
                """
                SELECT labels.*, sets.annotation_campaign_id, sets.id AS label_set_id
                FROM annotation_labels labels
                JOIN annotation_label_sets sets ON sets.id = labels.label_set_id
                WHERE labels.id = ?
                """,
                (label_id,),
            ).fetchone(),
            "label not found",
        )
        if int(label["annotation_campaign_id"]) != campaign_id:
            raise HTTPException(status_code=400, detail="label does not belong to annotation_campaign")
        conn.execute(
            """
            INSERT INTO annotation_items (uuid, annotation_campaign_id, track_id, track_sample_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(annotation_campaign_id, track_sample_id) DO NOTHING
            """,
            (new_uuid(), campaign_id, sample["track_id"], track_sample_id, timestamp, timestamp),
        )
        conn.execute(
            """
            INSERT INTO annotation_assignments (
                uuid, annotation_campaign_id, track_id, track_sample_id, label_set_id, label_id, annotator, confidence, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(annotation_campaign_id, track_sample_id, label_id) DO UPDATE SET
                annotator = excluded.annotator,
                confidence = excluded.confidence,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            (
                new_uuid(),
                campaign_id,
                sample["track_id"],
                track_sample_id,
                label["label_set_id"],
                label_id,
                annotator,
                confidence,
                notes,
                timestamp,
                timestamp,
            ),
        )
        return dict(
            conn.execute(
                "SELECT * FROM annotation_assignments WHERE annotation_campaign_id = ? AND track_sample_id = ? AND label_id = ?",
                (campaign_id, track_sample_id, label_id),
            ).fetchone()
        )


def list_assignments(campaign_id: int) -> list[dict[str, Any]]:
    """List label assignments for a campaign with label metadata."""
    init_annotation_db()
    with connect() as conn:
        get_annotation_campaign(campaign_id, conn)
        return [
            dict(row)
            for row in conn.execute(
                """
                SELECT aa.*, sets.name AS label_set_name, labels.name AS label_name, labels.color AS label_color
                FROM annotation_assignments aa
                JOIN annotation_label_sets sets ON sets.id = aa.label_set_id
                JOIN annotation_labels labels ON labels.id = aa.label_id
                WHERE aa.annotation_campaign_id = ?
                ORDER BY aa.track_id, aa.track_sample_id, sets.sort_order, labels.sort_order, labels.name
                """,
                (campaign_id,),
            )
        ]


def remove_assignment(assignment_id: int) -> dict[str, Any]:
    """Delete one annotation assignment and return the deleted row."""
    init_annotation_db()
    with connect() as conn:
        row = _require(conn.execute("SELECT * FROM annotation_assignments WHERE id = ?", (assignment_id,)).fetchone(), "assignment not found")
        conn.execute("DELETE FROM annotation_assignments WHERE id = ?", (assignment_id,))
        return dict(row)


def list_tracks(page: int = 1, page_size: int = 100) -> dict[str, Any]:
    """List source tracks available for annotation with pagination metadata."""
    init_annotation_db()
    offset = (page - 1) * page_size
    with connect() as conn:
        total = int(conn.execute("SELECT COUNT(*) AS count FROM tracks").fetchone()["count"])
        rows = conn.execute(
            """
            SELECT tracks.id, tracks.url, tracks.path, tracks.sample_count, artists.name AS artist_name
            FROM tracks
            LEFT JOIN artists ON artists.id = tracks.artist_id
            ORDER BY tracks.id
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        ).fetchall()
    return {"tracks": [dict(row) for row in rows], "page": page, "page_size": page_size, "total": total, "has_next": offset + len(rows) < total}


def list_track_samples(track_id: int) -> list[dict[str, Any]]:
    """List annotation-ready samples for one track."""
    init_annotation_db()
    with connect() as conn:
        _require(conn.execute("SELECT id FROM tracks WHERE id = ?", (track_id,)).fetchone(), "track not found")
        rows = conn.execute(
            """
            SELECT id AS sound_segment_id, id, track_id, chunk_index, start_seconds AS start_time,
                   start_seconds + duration_seconds AS end_time, duration_seconds
            FROM track_samples
            WHERE track_id = ?
            ORDER BY chunk_index
            """,
            (track_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def get_track_path(track_id: int) -> str:
    """Resolve the local audio path for a track.

    Raises:
        HTTPException: If the track or audio file cannot be found.
    """
    init_annotation_db()
    with connect() as conn:
        row = _require(conn.execute("SELECT path FROM tracks WHERE id = ?", (track_id,)).fetchone(), "track not found")
    if not row["path"]:
        raise HTTPException(status_code=404, detail="track audio path not stored")
    resolved = resolve_audio_path(str(row["path"]))
    if resolved is None:
        raise HTTPException(status_code=404, detail=f"track audio file not found: {row['path']}")
    return str(resolved)


def resolve_audio_path(path_value: str) -> Path | None:
    """Resolve a stored audio path across database and container roots."""
    original = Path(path_value).expanduser()
    candidates = [original]
    db_parent = get_database_path().parent
    if not original.is_absolute():
        candidates.append(db_parent / original)
        candidates.append(Path("/app") / original)

    roots = [Path(value).expanduser() for value in os.environ.get("ANNOTATION_AUDIO_ROOTS", "").split(",") if value.strip()]
    roots.extend([Path("/app/.songs_cache"), Path("/.songs_cache")])
    parts = original.parts
    if ".songs_cache" in parts:
        relative_to_cache = Path(*parts[parts.index(".songs_cache") + 1 :])
        candidates.extend(root / relative_to_cache for root in roots)

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None
