from __future__ import annotations

import sqlite3
import json
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import numpy as np
from fastapi import HTTPException

from .audio import preprocess_track
from .db import connect, ensure_entity_uuids
from .embeddings import aggregate_embeddings
from .provenance import canonical_json, config_hash, embedding_model_config, pipeline_config, sampling_strategy
from .responses import artist_response, row_dict, track_embedding_response, track_response, track_select_sql
from .schemas import ArtistCreate, ComputeRequest, DownloadRequest, SimilaritySearchRequest
from .soundcloud import ArtistData
from .vectorstore import get_vector_store


def get_artist(conn: sqlite3.Connection, artist_id: int) -> sqlite3.Row:
    """Load an artist row or raise a FastAPI 404.

    Args:
        conn: Open application database connection.
        artist_id: Artist primary key.

    Returns:
        Matching artist row.

    Raises:
        HTTPException: If the artist does not exist.
    """
    row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="artist not found")
    return row


def create_or_update_artist(payload: ArtistCreate, now: Callable[[], str]) -> dict[str, Any]:
    """Create an artist or update mutable metadata by name.

    Args:
        payload: Artist fields from the API request.
        now: Clock function used for timestamps.

    Returns:
        Artist response dictionary for the stored row.
    """
    timestamp = now()
    update_links = "links" in payload.model_fields_set
    update_images = "images" in payload.model_fields_set
    update_info = "info" in payload.model_fields_set
    update_socials = "socials" in payload.model_fields_set
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO artists (
                uuid, name, links, images, info, socials, bio, soundcloud_url, instagram, youtube, web, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                uuid = COALESCE(artists.uuid, excluded.uuid),
                links = CASE WHEN ? THEN excluded.links ELSE artists.links END,
                images = CASE WHEN ? THEN excluded.images ELSE artists.images END,
                info = CASE WHEN ? THEN excluded.info ELSE artists.info END,
                socials = CASE WHEN ? THEN excluded.socials ELSE artists.socials END,
                bio = COALESCE(excluded.bio, artists.bio),
                soundcloud_url = COALESCE(excluded.soundcloud_url, artists.soundcloud_url),
                instagram = COALESCE(excluded.instagram, artists.instagram),
                youtube = COALESCE(excluded.youtube, artists.youtube),
                web = COALESCE(excluded.web, artists.web),
                updated_at = excluded.updated_at
            """,
            (
                uuid4().hex,
                payload.name,
                json.dumps(payload.links),
                json.dumps(payload.images),
                json.dumps(payload.info),
                json.dumps(payload.socials),
                payload.bio,
                payload.soundcloud_url,
                payload.instagram,
                payload.youtube,
                payload.web,
                timestamp,
                timestamp,
                update_links,
                update_images,
                update_info,
                update_socials,
            ),
        )
        return artist_response(conn.execute("SELECT * FROM artists WHERE name = ?", (payload.name,)).fetchone())


def list_artists() -> list[dict[str, Any]]:
    """List all artists ordered by display name.

    Returns:
        Artist response dictionaries.
    """
    with connect() as conn:
        return [artist_response(row) for row in conn.execute("SELECT * FROM artists ORDER BY name")]


def get_artist_response(artist_id: int) -> dict[str, Any]:
    """Load one artist in API response format.

    Args:
        artist_id: Artist primary key.

    Returns:
        Artist response dictionary.

    Raises:
        HTTPException: If the artist does not exist.
    """
    with connect() as conn:
        return artist_response(get_artist(conn, artist_id))


def list_artist_tracks(artist_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    """List tracks for one artist.

    Args:
        artist_id: Artist primary key.
        include_embedding: Whether to include latest vector values.

    Returns:
        Track response dictionaries ordered by track ID.

    Raises:
        HTTPException: If the artist does not exist.
    """
    with connect() as conn:
        get_artist(conn, artist_id)
        rows = conn.execute(track_select_sql("tracks.artist_id = ?") + " ORDER BY tracks.id", (artist_id,)).fetchall()
        return [track_response(row, include_embedding=include_embedding) for row in rows]


def upsert_love_mobile(payload: dict[str, Any], now: Callable[[], str]) -> dict[str, Any]:
    """Create or update one love-mobile stage by source index.

    Args:
        payload: Love-mobile fields loaded from the source YAML.
        now: Clock function used for timestamps.

    Returns:
        Stored love-mobile row as a dictionary.
    """
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO love_mobiles (
                uuid, source_index, number, name, title, genres, motto, time, description, image, links, source, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_index) DO UPDATE SET
                uuid = COALESCE(love_mobiles.uuid, excluded.uuid),
                name = excluded.name,
                title = excluded.title,
                number = excluded.number,
                genres = excluded.genres,
                motto = excluded.motto,
                time = excluded.time,
                description = excluded.description,
                image = excluded.image,
                links = excluded.links,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            (
                uuid4().hex,
                int(payload["source_index"]),
                int(payload["number"]),
                str(payload["name"]),
                str(payload.get("title") or payload["name"]),
                payload.get("genres"),
                payload.get("motto"),
                payload.get("time"),
                payload.get("description"),
                json.dumps(payload.get("image") or {}),
                json.dumps(payload.get("links") or []),
                payload.get("source"),
                timestamp,
                timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM love_mobiles WHERE source_index = ?", (int(payload["source_index"]),)).fetchone()
        return row_dict(row)


def upsert_artist_love_mobile(
    artist_id: int,
    love_mobile_id: int,
    artist_name: str,
    artist_bio: str | None,
    artist_links: list[dict[str, Any]],
    now: Callable[[], str],
) -> dict[str, Any]:
    """Create or update the relation between an artist and a love mobile.

    Args:
        artist_id: Stored artist primary key.
        love_mobile_id: Stored love-mobile primary key.
        artist_name: Artist name as listed on the love-mobile source page.
        artist_bio: Bio from the love-mobile source page, if present.
        artist_links: Social/link data from the love-mobile source page.
        now: Clock function used for timestamps.

    Returns:
        Stored relation row as a dictionary.
    """
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO artist_love_mobiles (
                artist_id, love_mobile_id, artist_name, artist_bio, artist_links, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(artist_id, love_mobile_id) DO UPDATE SET
                artist_name = excluded.artist_name,
                artist_bio = COALESCE(excluded.artist_bio, artist_love_mobiles.artist_bio),
                artist_links = excluded.artist_links,
                updated_at = excluded.updated_at
            """,
            (artist_id, love_mobile_id, artist_name, artist_bio, json.dumps(artist_links), timestamp, timestamp),
        )
        row = conn.execute(
            "SELECT * FROM artist_love_mobiles WHERE artist_id = ? AND love_mobile_id = ?",
            (artist_id, love_mobile_id),
        ).fetchone()
        return row_dict(row)


def list_love_mobiles() -> list[dict[str, Any]]:
    """List love-mobile stages with decoded JSON metadata."""
    with connect() as conn:
        rows = conn.execute("SELECT * FROM love_mobiles ORDER BY source_index").fetchall()
    result = []
    for row in rows:
        item = row_dict(row)
        item["image"] = json.loads(item["image"] or "{}")
        item["links"] = json.loads(item["links"] or "[]")
        result.append(item)
    return result


def list_tracks(page: int = 1, page_size: int = 100, include_embedding: bool = False) -> dict[str, Any]:
    """List tracks with pagination metadata.

    Args:
        page: One-based page number.
        page_size: Number of tracks per page.
        include_embedding: Whether to include latest vector values.

    Returns:
        Dictionary containing tracks, pagination inputs, total count, and
        ``has_next``.

    Raises:
        HTTPException: If pagination values are invalid.
    """
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be greater than or equal to 1")
    if page_size < 1:
        raise HTTPException(status_code=400, detail="page_size must be greater than or equal to 1")

    offset = (page - 1) * page_size
    with connect() as conn:
        total = int(conn.execute("SELECT COUNT(*) AS count FROM tracks").fetchone()["count"])
        rows = conn.execute(
            track_select_sql("1 = 1") + " ORDER BY tracks.id LIMIT ? OFFSET ?",
            (page_size, offset),
        ).fetchall()
        return {
            "tracks": [track_response(row, include_embedding=include_embedding) for row in rows],
            "page": page,
            "page_size": page_size,
            "total": total,
            "has_next": offset + len(rows) < total,
        }


def validate_artist_download_request(artist_id: int, payload: DownloadRequest) -> dict[str, Any]:
    """Validate that an artist download request has a source of track URLs.

    Args:
        artist_id: Artist primary key.
        payload: Download request from the API.

    Returns:
        Artist response dictionary.

    Raises:
        HTTPException: If the artist is missing or no URL source is available.
    """
    artist = get_artist_response(artist_id)
    if payload.track_urls is None and not artist["soundcloud_url"]:
        raise HTTPException(status_code=400, detail="artist has no soundcloud_url and no track_urls were supplied")
    return artist


def get_track_samples(track_id: int) -> list[dict[str, Any]]:
    """List recorded audio chunks for a track.

    Args:
        track_id: Track primary key.

    Returns:
        Track sample rows ordered by chunk index.

    Raises:
        HTTPException: If the track does not exist.
    """
    with connect() as conn:
        if conn.execute("SELECT id FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="track not found")
        rows = conn.execute("SELECT * FROM track_samples WHERE track_id = ? ORDER BY chunk_index", (track_id,)).fetchall()
        return [row_dict(row) for row in rows]


def list_track_embeddings(track_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    """List embedding rows stored for one track.

    Args:
        track_id: Track primary key.
        include_embedding: Whether to include vector values from ChromaDB.

    Returns:
        Track embedding response dictionaries, newest first.

    Raises:
        HTTPException: If the track does not exist.
    """
    with connect() as conn:
        if conn.execute("SELECT id FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="track not found")
        rows = conn.execute(
            "SELECT * FROM track_embeddings WHERE track_id = ? ORDER BY embedded_at DESC, id DESC",
            (track_id,),
        ).fetchall()
        return [track_embedding_response(row, include_embedding=include_embedding) for row in rows]


def get_track_embedding(track_id: int) -> dict[str, Any]:
    """Load a track with its latest embedding vector.

    Args:
        track_id: Track primary key.

    Returns:
        Track response dictionary including the embedding.

    Raises:
        HTTPException: If the track or embedding does not exist.
    """
    with connect() as conn:
        row = conn.execute(track_select_sql("tracks.id = ?"), (track_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="track not found")
        if row["embedding_count"] == 0 and row["embedding"] is None:
            raise HTTPException(status_code=404, detail="track embedding not computed")
        return track_response(row, include_embedding=True)


def get_artist_embeddings(artist_id: int, include_tracks: bool = True) -> dict[str, Any]:
    """Aggregate stored track embeddings for one artist.

    Args:
        artist_id: Artist primary key.
        include_tracks: Whether to include individual track embedding rows.

    Returns:
        Artist metadata, track count, average embedding, and optionally track
        embeddings.

    Raises:
        HTTPException: If the artist does not exist.
    """
    with connect() as conn:
        artist = get_artist(conn, artist_id)
        rows = conn.execute(
            """
            SELECT te.*, tracks.url, tracks.path
            FROM track_embeddings te
            JOIN tracks ON tracks.id = te.track_id
            WHERE te.artist_id = ?
            ORDER BY te.track_id, te.id
            """,
            (artist_id,),
        ).fetchall()
        vector_store = get_vector_store()
        vectors = []
        for row in rows:
            vector = vector_store.get_embedding(row["vector_id"])
            if vector is not None:
                vectors.append(np.asarray(vector, dtype=np.float32))
        average = aggregate_embeddings(vectors)
        result: dict[str, Any] = {
            "artist": artist_response(artist),
            "track_count": len(rows),
            "average_embedding": average.astype(float).tolist() if average is not None else None,
        }
        if include_tracks:
            result["track_embeddings"] = [track_embedding_response(row, include_embedding=True) for row in rows]
        return result


def upsert_track(
    conn: sqlite3.Connection,
    artist_id: int,
    url: str,
    path: str | None,
    downloaded: bool,
    download_status: str | None,
    now: Callable[[], str],
) -> int:
    """Insert or update a track row for an artist URL.

    Args:
        conn: Open application database connection.
        artist_id: Owning artist primary key.
        url: Source media URL.
        path: Local cache path, if known.
        downloaded: Whether the track has a cached audio file.
        download_status: Explicit download status, or inferred when omitted.
        now: Clock function used for timestamps.

    Returns:
        Track primary key.
    """
    timestamp = now()
    status = download_status or ("completed" if downloaded else "not_started")
    conn.execute(
        """
        INSERT INTO tracks (uuid, artist_id, url, path, downloaded, download_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artist_id, url) DO UPDATE SET
            path = COALESCE(excluded.path, tracks.path),
            downloaded = CASE WHEN excluded.downloaded THEN 1 ELSE tracks.downloaded END,
            uuid = COALESCE(tracks.uuid, excluded.uuid),
            download_status = excluded.download_status,
            updated_at = excluded.updated_at
        """,
        (uuid4().hex, artist_id, url, path, int(downloaded), status, timestamp, timestamp),
    )
    return int(conn.execute("SELECT id FROM tracks WHERE artist_id = ? AND url = ?", (artist_id, url)).fetchone()["id"])


def set_track_download_status(
    conn: sqlite3.Connection,
    track_id: int,
    status: str,
    downloaded: bool | None,
    error: str | None,
    now: Callable[[], str],
) -> sqlite3.Row:
    """Update download status fields for a track.

    Args:
        conn: Open application database connection.
        track_id: Track primary key.
        status: New status string.
        downloaded: Optional downloaded flag; ``None`` preserves the current
            value.
        error: Last error message to store, or ``None`` to clear.
        now: Clock function used for timestamps.

    Returns:
        Updated track row.
    """
    downloaded_sql = "downloaded" if downloaded is None else "?"
    params: list[Any] = [status]
    if downloaded is not None:
        params.append(int(downloaded))
    params.extend([error, now(), track_id])
    conn.execute(
        f"""
        UPDATE tracks
        SET download_status = ?, downloaded = {downloaded_sql}, last_error = ?, updated_at = ?
        WHERE id = ?
        """,
        params,
    )
    return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()


def record_samples(
    conn: sqlite3.Connection,
    track_id: int,
    path: str | Path,
    sampling_rate: int,
    chunk_seconds: int,
    chunk_stride_seconds: int,
    max_chunks: int,
    now: Callable[[], str],
) -> int:
    """Preprocess a track and record its chunk metadata.

    Args:
        conn: Open application database connection.
        track_id: Track primary key.
        path: Local audio file path.
        sampling_rate: Target sampling rate for preprocessing.
        chunk_seconds: Duration of each chunk.
        chunk_stride_seconds: Step between chunk starts.
        max_chunks: Maximum chunks to record.
        now: Clock function used for timestamps.

    Returns:
        Number of recorded chunks.
    """
    chunks = preprocess_track(
        path,
        sampling_rate=sampling_rate,
        chunk_seconds=chunk_seconds,
        stride_seconds=chunk_stride_seconds,
        max_chunks=max_chunks,
    )
    conn.execute("DELETE FROM track_samples WHERE track_id = ?", (track_id,))
    for idx in range(len(chunks)):
        conn.execute(
            """
            INSERT INTO track_samples (track_id, chunk_index, start_seconds, duration_seconds)
            VALUES (?, ?, ?, ?)
            """,
            (track_id, idx, idx * chunk_stride_seconds, chunk_seconds),
        )
    conn.execute(
        """
        UPDATE tracks
        SET sample_count = ?, sampling_rate = ?, chunk_seconds = ?, chunk_stride_seconds = ?, max_chunks = ?,
            last_error = NULL, updated_at = ?
        WHERE id = ?
        """,
        (len(chunks), sampling_rate, chunk_seconds, chunk_stride_seconds, max_chunks, now(), track_id),
    )
    return len(chunks)


def select_embedding_rows(payload: ComputeRequest) -> list[dict[str, Any]]:
    """Select tracks that should be embedded for a compute request.

    Args:
        payload: Embedding request with filtering and idempotency settings.

    Returns:
        Track rows with artist UUIDs, ready for worker processing.

    Raises:
        HTTPException: If ``payload.artist_id`` is supplied but missing.
    """
    sampling_hash = config_hash(sampling_strategy(payload))
    model_hash = config_hash(embedding_model_config(payload))
    where = ["tracks.path IS NOT NULL"]
    params: list[Any] = []
    if payload.artist_id is not None:
        where.append("tracks.artist_id = ?")
        params.append(payload.artist_id)
    if payload.only_missing:
        where.append(
            """
            NOT EXISTS (
                SELECT 1 FROM track_embeddings te
                WHERE te.track_id = tracks.id
                  AND te.embedding_backend = ?
                  AND te.embedding_model = ?
                  AND te.embedding_model_config_hash = ?
                  AND te.sampling_strategy_hash = ?
            )
            """
        )
        params.extend([payload.embedding_backend, payload.model_name, model_hash, sampling_hash])

    query = f"""
        SELECT tracks.*, artists.uuid AS artist_uuid
        FROM tracks
        JOIN artists ON artists.id = tracks.artist_id
        WHERE {' AND '.join(where)}
        ORDER BY tracks.artist_id, tracks.id
    """
    if payload.max_tracks is not None:
        query += " LIMIT ?"
        params.append(payload.max_tracks)

    with connect() as conn:
        ensure_entity_uuids(conn)
        if payload.artist_id is not None:
            get_artist(conn, payload.artist_id)
        return [row_dict(row) for row in conn.execute(query, params).fetchall()]


def store_track_embedding(row: dict[str, Any], embedding: np.ndarray, payload: ComputeRequest, now: Callable[[], str]) -> sqlite3.Row:
    """Store a track-level embedding in ChromaDB and SQLite metadata.

    Args:
        row: Track row selected by :func:`select_embedding_rows`.
        embedding: Track-level embedding vector.
        payload: Embedding request used to compute provenance hashes.
        now: Clock function used for timestamps.

    Returns:
        Updated track row.
    """
    track_id = int(row["id"])
    artist_id = int(row["artist_id"])
    artist_uuid = str(row["artist_uuid"])
    embedding_uuid = uuid4().hex
    vector_id = f"track:{track_id}:embedding:{embedding_uuid}"
    sample_strategy = sampling_strategy(payload)
    sampling_hash = config_hash(sample_strategy)
    model_config = embedding_model_config(payload)
    model_hash = config_hash(model_config)
    run_config = pipeline_config(payload)
    embedded_at = now()
    metadata = {
        "vector_id": vector_id,
        "track_id": track_id,
        "track_uuid": row.get("uuid"),
        "artist_id": artist_id,
        "artist_uuid": artist_uuid,
        "source_url": row.get("url"),
        "embedding_backend": payload.embedding_backend,
        "embedding_model": payload.model_name,
        "embedding_model_config_hash": model_hash,
        "sampling_strategy_hash": sampling_hash,
        "embedding_dim": int(embedding.shape[0]),
        "embedded_at": embedded_at,
    }
    get_vector_store().upsert_embedding(vector_id, embedding, metadata)
    with connect() as conn:
        timestamp = now()
        conn.execute(
            """
            INSERT INTO track_embeddings (
                uuid, vector_id, track_id, artist_id, artist_uuid, embedding_backend, embedding_model,
                embedding_model_config, embedding_model_config_hash, sampling_strategy, sampling_strategy_hash,
                pipeline_config, embedding_dim, embedded_at, last_error, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(track_id, embedding_backend, embedding_model, embedding_model_config_hash, sampling_strategy_hash)
            DO UPDATE SET
                vector_id = excluded.vector_id,
                uuid = excluded.uuid,
                artist_uuid = excluded.artist_uuid,
                embedding_model_config = excluded.embedding_model_config,
                sampling_strategy = excluded.sampling_strategy,
                pipeline_config = excluded.pipeline_config,
                embedding_dim = excluded.embedding_dim,
                embedded_at = excluded.embedded_at,
                last_error = NULL,
                updated_at = excluded.updated_at
            """,
            (
                embedding_uuid,
                vector_id,
                track_id,
                artist_id,
                artist_uuid,
                payload.embedding_backend,
                payload.model_name,
                canonical_json(model_config),
                model_hash,
                canonical_json(sample_strategy),
                sampling_hash,
                canonical_json(run_config),
                int(embedding.shape[0]),
                embedded_at,
                timestamp,
                timestamp,
            ),
        )
        conn.execute(
            """
            UPDATE tracks
            SET embedding_dim = ?, embedding_model = ?, embedded_at = ?, last_error = NULL,
                sampling_rate = ?, chunk_seconds = ?, chunk_stride_seconds = ?, max_chunks = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                int(embedding.shape[0]),
                payload.model_name,
                embedded_at,
                payload.sampling_rate,
                payload.chunk_seconds,
                payload.chunk_stride_seconds,
                payload.max_chunks,
                timestamp,
                track_id,
            ),
        )
        return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()


def store_sample_embeddings(
    row: dict[str, Any],
    embeddings: np.ndarray,
    payload: ComputeRequest,
    now: Callable[[], str],
) -> list[dict[str, Any]]:
    """Store per-segment embeddings for a track.

    Args:
        row: Track row selected by :func:`select_embedding_rows`.
        embeddings: Two-dimensional segment embedding array.
        payload: Embedding request used to compute provenance hashes.
        now: Clock function used for timestamps.

    Returns:
        Stored sample embedding metadata rows.

    Raises:
        ValueError: If the embedding array shape does not match recorded chunks.
    """
    track_id = int(row["id"])
    vectors = np.asarray(embeddings, dtype=np.float32)
    if vectors.ndim != 2:
        raise ValueError("segment embeddings must be a 2D array")

    sample_strategy = sampling_strategy(payload)
    sampling_hash = config_hash(sample_strategy)
    model_config = embedding_model_config(payload)
    model_hash = config_hash(model_config)
    run_config = pipeline_config(payload)
    vector_store = get_vector_store()
    stored: list[dict[str, Any]] = []

    with connect() as conn:
        samples = conn.execute(
            """
            SELECT * FROM track_samples
            WHERE track_id = ?
            ORDER BY chunk_index
            LIMIT ?
            """,
            (track_id, vectors.shape[0]),
        ).fetchall()
        if len(samples) != vectors.shape[0]:
            raise ValueError(f"expected {len(samples)} segment embeddings, got {vectors.shape[0]}")

        for sample, vector in zip(samples, vectors):
            timestamp = now()
            embedding_uuid = uuid4().hex
            vector_id = f"sample:{sample['id']}:embedding:{embedding_uuid}"
            metadata = {
                "vector_id": vector_id,
                "track_id": track_id,
                "track_uuid": row.get("uuid"),
                "track_sample_id": int(sample["id"]),
                "chunk_index": int(sample["chunk_index"]),
                "start_seconds": float(sample["start_seconds"]),
                "duration_seconds": float(sample["duration_seconds"]),
                "embedding_backend": payload.embedding_backend,
                "embedding_model": payload.model_name,
                "embedding_model_config_hash": model_hash,
                "sampling_strategy_hash": sampling_hash,
                "embedding_dim": int(vector.shape[0]),
                "embedded_at": timestamp,
            }
            vector_store.upsert_embedding(vector_id, vector, metadata)
            conn.execute(
                """
                INSERT INTO sample_embeddings (
                    uuid, vector_id, track_id, track_sample_id, chunk_index, start_seconds, duration_seconds,
                    embedding_backend, embedding_model, embedding_model_config, embedding_model_config_hash,
                    sampling_strategy, sampling_strategy_hash, pipeline_config, embedding_dim, embedded_at,
                    last_error, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                ON CONFLICT(track_sample_id, embedding_backend, embedding_model, embedding_model_config_hash, sampling_strategy_hash)
                DO UPDATE SET
                    uuid = excluded.uuid,
                    vector_id = excluded.vector_id,
                    chunk_index = excluded.chunk_index,
                    start_seconds = excluded.start_seconds,
                    duration_seconds = excluded.duration_seconds,
                    embedding_model_config = excluded.embedding_model_config,
                    sampling_strategy = excluded.sampling_strategy,
                    pipeline_config = excluded.pipeline_config,
                    embedding_dim = excluded.embedding_dim,
                    embedded_at = excluded.embedded_at,
                    last_error = NULL,
                    updated_at = excluded.updated_at
                """,
                (
                    embedding_uuid,
                    vector_id,
                    track_id,
                    int(sample["id"]),
                    int(sample["chunk_index"]),
                    float(sample["start_seconds"]),
                    float(sample["duration_seconds"]),
                    payload.embedding_backend,
                    payload.model_name,
                    canonical_json(model_config),
                    model_hash,
                    canonical_json(sample_strategy),
                    sampling_hash,
                    canonical_json(run_config),
                    int(vector.shape[0]),
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            stored.append(row_dict(conn.execute("SELECT * FROM sample_embeddings WHERE vector_id = ?", (vector_id,)).fetchone()))
    return stored


def store_track_error(track_id: int, error: str, now: Callable[[], str]) -> sqlite3.Row:
    """Persist the latest embedding or processing error for a track.

    Args:
        track_id: Track primary key.
        error: Error message to store.
        now: Clock function used for timestamps.

    Returns:
        Updated track row.
    """
    with connect() as conn:
        conn.execute("UPDATE tracks SET last_error = ?, updated_at = ? WHERE id = ?", (error, now(), track_id))
        return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()


def get_artist_dict(artist_id: int) -> dict[str, Any]:
    """Load one artist as a response dictionary.

    Args:
        artist_id: Artist primary key.

    Returns:
        Artist response dictionary.
    """
    with connect() as conn:
        return artist_response(get_artist(conn, artist_id))


def prepare_track_download(artist_id: int, artist_name: str, track_url: str, cache_dir: str, now: Callable[[], str]) -> dict[str, Any]:
    """Create or mark a track row before a download worker runs.

    Args:
        artist_id: Owning artist primary key.
        artist_name: Artist name used for cache path derivation.
        track_url: SoundCloud track URL.
        cache_dir: Root audio cache directory.
        now: Clock function used for timestamps.

    Returns:
        Track response dictionary in ``downloading`` state.
    """
    path = ArtistData(artist_name, [track_url], cache_folder=cache_dir).get_track_path_by_url(track_url)
    with connect() as conn:
        track_id = upsert_track(
            conn,
            artist_id,
            track_url,
            str(path),
            downloaded=path.exists(),
            download_status="downloading",
            now=now,
        )
        return track_response(conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone())


def complete_track_download(track_id: int, path: str | Path, payload: DownloadRequest, now: Callable[[], str]) -> sqlite3.Row:
    """Mark a track download as complete and record sample metadata.

    Args:
        track_id: Track primary key.
        path: Local audio file path.
        payload: Download request containing sampling settings.
        now: Clock function used for timestamps.

    Returns:
        Updated track row.
    """
    with connect() as conn:
        row = set_track_download_status(conn, track_id, "completed", downloaded=True, error=None, now=now)
        try:
            record_samples(
                conn,
                track_id,
                path,
                payload.sampling_rate,
                payload.chunk_seconds,
                payload.chunk_stride_seconds,
                payload.max_chunks,
                now=now,
            )
        except Exception as exc:
            conn.execute("UPDATE tracks SET last_error = ?, updated_at = ? WHERE id = ?", (str(exc), now(), track_id))
        return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone() or row


def fail_track_download(track_id: int, path: str | Path, error: str, now: Callable[[], str]) -> sqlite3.Row:
    """Mark a track download as failed unless the file exists anyway.

    Args:
        track_id: Track primary key.
        path: Expected local audio file path.
        error: Error message to store.
        now: Clock function used for timestamps.

    Returns:
        Updated track row.
    """
    with connect() as conn:
        file_exists = Path(path).exists()
        status = "completed" if file_exists else "failed"
        return set_track_download_status(conn, track_id, status, downloaded=file_exists, error=error, now=now)


def similarity_where(payload: SimilaritySearchRequest) -> dict[str, Any] | None:
    """Build a ChromaDB metadata filter for similarity search.

    Args:
        payload: Similarity request with optional metadata filters.

    Returns:
        ChromaDB ``where`` filter, or ``None`` when no filters are present.
    """
    where: dict[str, Any] = {}
    if payload.artist_id is not None:
        where["artist_id"] = payload.artist_id
    if payload.embedding_backend is not None:
        where["embedding_backend"] = payload.embedding_backend
    if payload.embedding_model is not None:
        where["embedding_model"] = payload.embedding_model
    if payload.sampling_strategy_hash is not None:
        where["sampling_strategy_hash"] = payload.sampling_strategy_hash
    return where or None


def latest_vector_ids_for_tracks(track_ids: list[int]) -> list[str]:
    """Load latest embedding vector IDs for track IDs.

    Args:
        track_ids: Track primary keys.

    Returns:
        Latest vector IDs ordered by track ID.
    """
    if not track_ids:
        return []
    placeholders = ",".join("?" for _ in track_ids)
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT vector_id
            FROM track_embeddings te
            WHERE te.track_id IN ({placeholders})
              AND te.id = (
                  SELECT id FROM track_embeddings latest
                  WHERE latest.track_id = te.track_id
                  ORDER BY latest.embedded_at DESC, latest.id DESC
                  LIMIT 1
              )
            ORDER BY te.track_id
            """,
            track_ids,
        ).fetchall()
    return [row["vector_id"] for row in rows]


def embedding_row_by_vector_id(vector_id: str) -> dict[str, Any] | None:
    """Load embedding metadata and joined track/artist fields by vector ID.

    Args:
        vector_id: Stored ChromaDB vector ID.

    Returns:
        Metadata dictionary, or ``None`` when not found.
    """
    with connect() as conn:
        row = conn.execute(
            """
            SELECT te.*, tracks.url, tracks.path, artists.name AS artist_name
            FROM track_embeddings te
            JOIN tracks ON tracks.id = te.track_id
            JOIN artists ON artists.id = te.artist_id
            WHERE te.vector_id = ?
            """,
            (vector_id,),
        ).fetchone()
    return row_dict(row) if row is not None else None


def similarity_query_vector(payload: SimilaritySearchRequest) -> np.ndarray:
    """Resolve a similarity request into one query vector.

    Args:
        payload: Similarity request containing a raw vector, vector IDs, or
            track IDs.

    Returns:
        Query vector, averaging multiple referenced vectors when necessary.

    Raises:
        HTTPException: If no query source is supplied or referenced vectors are
            missing.
    """
    vector_store = get_vector_store()
    if payload.embedding is not None:
        return np.asarray(payload.embedding, dtype=np.float32)
    vector_ids = payload.vector_ids or []
    if payload.track_ids:
        vector_ids = vector_ids + latest_vector_ids_for_tracks(payload.track_ids)
    if not vector_ids:
        raise HTTPException(status_code=400, detail="provide embedding, vector_ids, or track_ids")
    vectors = [vector_store.get_embedding(vector_id) for vector_id in vector_ids]
    vectors = [vector for vector in vectors if vector is not None]
    if not vectors:
        raise HTTPException(status_code=404, detail="query embeddings not found")
    return np.mean(np.asarray(vectors, dtype=np.float32), axis=0)


def latest_similarity_rows(payload: SimilaritySearchRequest) -> list[dict[str, Any]]:
    """Load latest embedding rows that match similarity filters.

    Args:
        payload: Similarity request with optional metadata filters.

    Returns:
        Joined embedding rows for distance search.
    """
    clauses = [
        "te.id = (SELECT id FROM track_embeddings latest WHERE latest.track_id = te.track_id ORDER BY latest.embedded_at DESC, latest.id DESC LIMIT 1)"
    ]
    params: list[Any] = []
    if payload.artist_id is not None:
        clauses.append("te.artist_id = ?")
        params.append(payload.artist_id)
    if payload.embedding_backend is not None:
        clauses.append("te.embedding_backend = ?")
        params.append(payload.embedding_backend)
    if payload.embedding_model is not None:
        clauses.append("te.embedding_model = ?")
        params.append(payload.embedding_model)
    if payload.sampling_strategy_hash is not None:
        clauses.append("te.sampling_strategy_hash = ?")
        params.append(payload.sampling_strategy_hash)
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT te.*, tracks.url, tracks.path, artists.name AS artist_name
            FROM track_embeddings te
            JOIN tracks ON tracks.id = te.track_id
            JOIN artists ON artists.id = te.artist_id
            WHERE {' AND '.join(clauses)}
            """,
            params,
        ).fetchall()
    return [row_dict(row) for row in rows]


def euclidean_similarity_search(payload: SimilaritySearchRequest) -> list[dict[str, Any]]:
    """Run Euclidean similarity search against latest stored embeddings.

    Args:
        payload: Similarity request with query source and filters.

    Returns:
        Ranked results with distance and ``1 / (1 + distance)`` similarity.
    """
    vector_store = get_vector_store()
    query = similarity_query_vector(payload)
    results = []
    for row in latest_similarity_rows(payload):
        vector = vector_store.get_embedding(row["vector_id"])
        if vector is None:
            continue
        distance = float(np.linalg.norm(query - np.asarray(vector, dtype=np.float32)))
        results.append(
            {
                "vector_id": row["vector_id"],
                "distance": distance,
                "similarity": 1.0 / (1.0 + distance),
                "metadata": {"track_id": row["track_id"], "artist_id": row["artist_id"]},
                "track_embedding": row,
            }
        )
    return sorted(results, key=lambda item: item["distance"])[: payload.n_results]


def similarity_search(payload: SimilaritySearchRequest) -> list[dict[str, Any]]:
    """Run similarity search using the requested metric.

    Args:
        payload: Similarity request with query source, filters, metric, and
            result limit.

    Returns:
        Ranked results with vector-store result data and joined embedding rows.

    Raises:
        HTTPException: If no query source is supplied or referenced vectors are
            missing.
    """
    if payload.metric == "euclidean":
        return euclidean_similarity_search(payload)
    vector_store = get_vector_store()
    where = similarity_where(payload)
    if payload.embedding is not None:
        results = vector_store.query_by_vector(payload.embedding, n_results=payload.n_results, where=where)
    else:
        vector_ids = payload.vector_ids or []
        if payload.track_ids:
            vector_ids = vector_ids + latest_vector_ids_for_tracks(payload.track_ids)
        if not vector_ids:
            raise HTTPException(status_code=400, detail="provide embedding, vector_ids, or track_ids")
        results = vector_store.query_by_embedding_ids(vector_ids, n_results=payload.n_results, where=where)

    return [{**item, "track_embedding": embedding_row_by_vector_id(item["vector_id"])} for item in results]
