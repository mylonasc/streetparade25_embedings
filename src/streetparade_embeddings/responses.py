from __future__ import annotations

import json
import sqlite3
from typing import Any

import numpy as np

from .db import connect
from .vectorstore import get_vector_store


def row_dict(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a SQLite row to a plain dictionary.

    Args:
        row: Row returned by a SQLite query.

    Returns:
        Dictionary keyed by column name.
    """
    return dict(row)


def json_list(value: str | None) -> list[str]:
    """Decode a JSON list column into a list of strings.

    Args:
        value: JSON string or ``None`` from SQLite.

    Returns:
        Decoded string list, or an empty list for missing/non-list values.
    """
    if not value:
        return []
    loaded = json.loads(value)
    if not isinstance(loaded, list):
        return []
    return [str(item) for item in loaded]


def json_data(value: str | None, default: Any) -> Any:
    """Decode JSON data with a fallback for missing or invalid values.

    Args:
        value: JSON string or ``None`` from SQLite.
        default: Value returned when decoding is not possible.

    Returns:
        Decoded JSON value or ``default``.
    """
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def artist_response(row: sqlite3.Row) -> dict[str, Any]:
    """Convert an artist row into the HTTP response shape.

    Args:
        row: Artist row from SQLite.

    Returns:
        Response dictionary with JSON columns decoded.
    """
    result = row_dict(row)
    result["links"] = json_list(result.get("links"))
    result["images"] = json_list(result.get("images"))
    result["info"] = json_list(result.get("info"))
    result["socials"] = json_data(result.get("socials"), [])
    return result


def track_response(row: sqlite3.Row, include_embedding: bool = False) -> dict[str, Any]:
    """Convert a track row into the HTTP response shape.

    Args:
        row: Track row, optionally including joined latest embedding fields.
        include_embedding: Whether to include the latest vector values.

    Returns:
        Response dictionary with booleans normalized and embedding metadata
        summarized.
    """
    result = row_dict(row)
    result["downloaded"] = bool(result["downloaded"])
    legacy_embedding = result.pop("embedding", None)
    embedding_count = result.get("embedding_count")
    latest_vector_id = result.get("latest_vector_id")
    result["embedding_count"] = int(embedding_count) if embedding_count is not None else track_embedding_count(result["id"])
    result["has_embedding"] = result["embedding_count"] > 0 or legacy_embedding is not None
    if result.get("latest_embedding_dim") is not None:
        result["embedding_dim"] = result["latest_embedding_dim"]
    if include_embedding:
        if latest_vector_id:
            result["embedding"] = get_vector_store().get_embedding(str(latest_vector_id))
            result["vector_id"] = latest_vector_id
        else:
            result["embedding"] = embedding_from_blob(legacy_embedding)
    return result


def track_embedding_response(row: sqlite3.Row, include_embedding: bool = False) -> dict[str, Any]:
    """Convert a track embedding row into the HTTP response shape.

    Args:
        row: Track embedding row from SQLite.
        include_embedding: Whether to include vector values from ChromaDB.

    Returns:
        Response dictionary with provenance JSON decoded.
    """
    result = row_dict(row)
    result["embedding_model_config"] = json_data(result.get("embedding_model_config"), {})
    result["sampling_strategy"] = json_data(result.get("sampling_strategy"), {})
    result["pipeline_config"] = json_data(result.get("pipeline_config"), {})
    if include_embedding:
        result["embedding"] = get_vector_store().get_embedding(result["vector_id"])
    return result


def track_embedding_count(track_id: int) -> int:
    """Count stored embedding rows for a track.

    Args:
        track_id: SQLite track primary key.

    Returns:
        Number of embedding metadata rows for the track.
    """
    with connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS count FROM track_embeddings WHERE track_id = ?", (track_id,)).fetchone()
    return int(row["count"])


def track_select_sql(where: str) -> str:
    """Build the common track SELECT query with embedding summary joins.

    Args:
        where: SQL predicate appended to the query's ``WHERE`` clause.

    Returns:
        SQL query string selecting track fields plus latest embedding metadata.
    """
    return f"""
        SELECT
            tracks.*,
            COALESCE(embedding_counts.embedding_count, 0) AS embedding_count,
            latest.vector_id AS latest_vector_id,
            latest.embedding_dim AS latest_embedding_dim
        FROM tracks
        LEFT JOIN (
            SELECT track_id, COUNT(*) AS embedding_count
            FROM track_embeddings
            GROUP BY track_id
        ) embedding_counts ON embedding_counts.track_id = tracks.id
        LEFT JOIN track_embeddings latest ON latest.id = (
            SELECT id FROM track_embeddings te
            WHERE te.track_id = tracks.id
            ORDER BY te.embedded_at DESC, te.id DESC
            LIMIT 1
        )
        WHERE {where}
    """


def embedding_from_blob(blob: bytes | None) -> list[float] | None:
    """Decode a legacy float32 embedding blob.

    Args:
        blob: Raw SQLite BLOB containing float32 vector bytes.

    Returns:
        List of floats, or ``None`` when no blob is present.
    """
    if blob is None:
        return None
    return np.frombuffer(blob, dtype=np.float32).astype(float).tolist()
