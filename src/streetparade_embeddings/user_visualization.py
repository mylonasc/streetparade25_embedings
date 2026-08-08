from __future__ import annotations

import json
import math
import os
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse
from uuid import uuid4

import numpy as np
from fastapi import HTTPException
from sklearn.cluster import SpectralClustering
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
from sklearn.metrics.pairwise import euclidean_distances

from .db import connect, ensure_entity_uuids, init_db
from .embeddings import ClapEmbeddingModel
from .repositories import create_or_update_artist, store_track_embedding, upsert_track
from .schemas import ArtistCreate, ComputeRequest, LayoutRequest
from .soundcloud import download_track_to_cache
from .youtube import download_youtube_to_cache
from .vectorstore import get_vector_store


USER_CACHE_DIR = Path(".songs_cache/user_added")
USER_ARTIST_PREFIX = "User Added"


@dataclass
class UserTrackJob:
    """Persistable status for analyzing a user-submitted track."""

    id: str
    user_track_id: int
    status: str = "queued"
    phase: str | None = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: _now())
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Serialize the job for API responses."""
        return self.__dict__.copy()


@dataclass
class LayoutJob:
    """Persistable status for a visualization layout recomputation job."""

    id: str
    username: str | None
    request: LayoutRequest = field(default_factory=LayoutRequest)
    status: str = "queued"
    error: str | None = None
    created_at: str = field(default_factory=lambda: _now())
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Serialize the job for API responses."""
        data = self.__dict__.copy()
        data["request"] = self.request.model_dump(mode="json")
        return data


def _now() -> str:
    return datetime.now(UTC).isoformat()


def normalize_username(username: str) -> str:
    """Normalize and validate a public visualization username.

    Args:
        username: User-supplied username.

    Returns:
        Lowercase normalized username.

    Raises:
        HTTPException: If the username does not match the allowed format.
    """
    value = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{1,62}", value):
        raise HTTPException(status_code=400, detail="username must be 2-63 chars: letters, numbers, _, ., -")
    return value


def source_type(url: str) -> str:
    """Classify a submitted URL as SoundCloud or YouTube.

    Args:
        url: User-submitted media URL.

    Returns:
        Source type string stored with the user track.

    Raises:
        HTTPException: If the URL host is unsupported.
    """
    host = urlparse(url).netloc.lower()
    if "soundcloud.com" in host:
        return "soundcloud"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    raise HTTPException(status_code=400, detail="only SoundCloud and YouTube URLs are supported")


def get_or_create_user(username: str, now: Callable[[], str] = _now) -> dict[str, Any]:
    """Create or refresh a visualization user.

    Args:
        username: Public username.
        now: Clock function used for timestamps.

    Returns:
        Stored user row as a dictionary.
    """
    init_db()
    username = normalize_username(username)
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO users (uuid, username, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET updated_at = excluded.updated_at
            """,
            (uuid4().hex, username, timestamp, timestamp),
        )
        return row_dict(conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone())


def get_user(username: str) -> dict[str, Any]:
    """Load a visualization user by username.

    Args:
        username: Public username.

    Returns:
        Stored user row as a dictionary.

    Raises:
        HTTPException: If the user does not exist.
    """
    init_db()
    username = normalize_username(username)
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user not found")
    return row_dict(row)


def create_user_track(username: str, url: str, now: Callable[[], str] = _now) -> dict[str, Any]:
    """Create or refresh a user-submitted track row.

    Args:
        username: Public username that owns the track.
        url: SoundCloud or YouTube URL.
        now: Clock function used for timestamps.

    Returns:
        User-track response dictionary.
    """
    user = get_or_create_user(username, now)
    url = url.strip()
    kind = source_type(url)
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO user_tracks (uuid, user_id, source_url, source_type, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'queued', ?, ?)
            ON CONFLICT(user_id, source_url) DO UPDATE SET updated_at = excluded.updated_at
            """,
            (uuid4().hex, user["id"], url, kind, timestamp, timestamp),
        )
        row = conn.execute(
            """
            SELECT ut.*, users.username
            FROM user_tracks ut
            JOIN users ON users.id = ut.user_id
            WHERE ut.user_id = ? AND ut.source_url = ?
            """,
            (user["id"], url),
        ).fetchone()
    return user_track_response(row)


def list_user_tracks(username: str) -> list[dict[str, Any]]:
    """List tracks submitted by a user.

    Args:
        username: Public username.

    Returns:
        User-track response dictionaries ordered newest first.
    """
    user = get_user(username)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT ut.*, users.username
            FROM user_tracks ut
            JOIN users ON users.id = ut.user_id
            WHERE ut.user_id = ?
            ORDER BY ut.created_at DESC, ut.id DESC
            """,
            (user["id"],),
        ).fetchall()
    return [user_track_response(row) for row in rows]


def set_user_track_status(user_track_id: int, status: str, phase: str | None = None, error: str | None = None) -> None:
    """Update status fields for a user-submitted track.

    Args:
        user_track_id: User track primary key.
        status: New status string.
        phase: Optional phase label; currently accepted for API symmetry.
        error: Last error message to store, or ``None`` to clear.
    """
    with connect() as conn:
        conn.execute(
            "UPDATE user_tracks SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
            (status, error, _now(), user_track_id),
        )


def update_user_track_after_embedding(
    user_track_id: int,
    title: str | None,
    artist: str | None,
    track_id: int,
    vector_id: str,
    x: float | None,
    y: float | None,
    placement_method: str,
) -> None:
    """Mark a user track complete after embedding and placement.

    Args:
        user_track_id: User track primary key.
        title: Display title inferred from media metadata.
        artist: Display artist inferred from media metadata.
        track_id: Canonical track row linked to the user submission.
        vector_id: Latest stored embedding vector ID.
        x: Initial map x-coordinate.
        y: Initial map y-coordinate.
        placement_method: Method used to derive initial coordinates.
    """
    with connect() as conn:
        conn.execute(
            """
            UPDATE user_tracks
            SET title = ?, artist = ?, status = 'completed', track_id = ?, vector_id = ?, x = ?, y = ?,
                placement_method = ?, last_error = NULL, updated_at = ?
            WHERE id = ?
            """,
            (title, artist, track_id, vector_id, x, y, placement_method, _now(), user_track_id),
        )


def get_user_track(user_track_id: int) -> dict[str, Any]:
    """Load a user-submitted track by primary key.

    Args:
        user_track_id: User track primary key.

    Returns:
        User-track response dictionary.

    Raises:
        HTTPException: If the row does not exist.
    """
    with connect() as conn:
        row = conn.execute(
            """
            SELECT ut.*, users.username
            FROM user_tracks ut
            JOIN users ON users.id = ut.user_id
            WHERE ut.id = ?
            """,
            (user_track_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user track not found")
    return user_track_response(row)


def get_user_track_for_username(username: str, user_track_id: int) -> dict[str, Any]:
    """Load a user-submitted track scoped to its owner.

    Args:
        username: Public username that must own the track.
        user_track_id: User track primary key.

    Returns:
        User-track response dictionary with joined audio path.

    Raises:
        HTTPException: If the user or track does not exist.
    """
    user = get_user(username)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT ut.*, users.username, tracks.path
            FROM user_tracks ut
            JOIN users ON users.id = ut.user_id
            LEFT JOIN tracks ON tracks.id = ut.track_id
            WHERE ut.id = ? AND ut.user_id = ?
            """,
            (user_track_id, user["id"]),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user track not found")
    return user_track_response(row)


def record_user_track_job(job: UserTrackJob) -> None:
    """Persist the current status of a user-track analysis job."""
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO user_track_jobs (id, user_track_id, status, phase, error, created_at, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (job.id, job.user_track_id, job.status, job.phase, job.error, job.created_at, job.started_at, job.finished_at),
        )


def load_user_track_job(job_id: str) -> dict[str, Any] | None:
    """Load a persisted user-track analysis job by ID."""
    with connect() as conn:
        row = conn.execute("SELECT * FROM user_track_jobs WHERE id = ?", (job_id,)).fetchone()
    return row_dict(row) if row else None


def user_track_response(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    """Normalize a user-track row for API responses."""
    data = row_dict(row)
    if data.get("x") is not None:
        data["x"] = float(data["x"])
    if data.get("y") is not None:
        data["y"] = float(data["y"])
    return data


def row_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    """Convert a SQLite row or mapping to a plain dictionary."""
    return dict(row)


def analyze_user_track(user_track_id: int, model: ClapEmbeddingModel, request: ComputeRequest) -> dict[str, Any]:
    """Download, embed, store, and place a user-submitted track.

    Args:
        user_track_id: User track primary key.
        model: Loaded embedding model.
        request: Embedding request controlling preprocessing and model settings.

    Returns:
        Updated user-track response dictionary.
    """
    user_track = get_user_track(user_track_id)
    set_user_track_status(user_track_id, "running")
    url = user_track["source_url"]
    username = user_track["username"]
    cache_dir = USER_CACHE_DIR / username

    if user_track["source_type"] == "youtube":
        download = download_youtube_to_cache(url, cache_dir, artist=username)
    else:
        download = download_track_to_cache(url, cache_dir, artist=username)

    artist_name = f"{USER_ARTIST_PREFIX}: {username}"
    artist = create_or_update_artist(
        ArtistCreate(name=artist_name, links=[url], images=[], info=[], socials=[], bio=None, soundcloud_url=None),
        _now,
    )
    with connect() as conn:
        ensure_entity_uuids(conn)
        track_id = upsert_track(conn, artist["id"], url, str(download.path), True, "completed", _now)
        row = conn.execute(
            """
            SELECT tracks.*, artists.uuid AS artist_uuid
            FROM tracks
            JOIN artists ON artists.id = tracks.artist_id
            WHERE tracks.id = ?
            """,
            (track_id,),
        ).fetchone()
        track_row = row_dict(row)

    embedding = model.embed_track(
        download.path,
        sampling_rate=request.sampling_rate,
        chunk_seconds=request.chunk_seconds,
        stride_seconds=request.chunk_stride_seconds,
        max_chunks=request.max_chunks,
    )
    store_track_embedding(track_row, embedding, request, _now)
    vector_id = latest_vector_id_for_track(track_id)
    x, y = approximate_user_coordinates(embedding)
    update_user_track_after_embedding(
        user_track_id,
        title=download.title if hasattr(download, "title") else title_from_url(url),
        artist=download.artist,
        track_id=track_id,
        vector_id=vector_id,
        x=x,
        y=y,
        placement_method="top5_euclidean_average",
    )
    return get_user_track(user_track_id)


def latest_vector_id_for_track(track_id: int) -> str:
    """Return the most recent vector ID stored for a track.

    Raises:
        RuntimeError: If the track has no stored embedding row.
    """
    with connect() as conn:
        row = conn.execute(
            """
            SELECT vector_id FROM track_embeddings
            WHERE track_id = ?
            ORDER BY embedded_at DESC, id DESC
            LIMIT 1
            """,
            (track_id,),
        ).fetchone()
    if row is None:
        raise RuntimeError("embedding was not stored")
    return str(row["vector_id"])


def latest_layout_points(username: str | None = None) -> list[dict[str, Any]] | None:
    """Load the newest completed persisted layout for a user scope."""
    with connect() as conn:
        row = conn.execute(
            """
            SELECT points_json FROM embedding_layouts
            WHERE status = 'completed' AND COALESCE(username, '') = COALESCE(?, '')
            ORDER BY finished_at DESC, created_at DESC
            LIMIT 1
            """,
            (normalize_username(username) if username else None,),
        ).fetchone()
    if row is None or not row["points_json"]:
        return None
    return json.loads(row["points_json"])


def visualization_points(username: str | None = None) -> list[dict[str, Any]]:
    """Build visualization points from cached layout or live embeddings."""
    points = latest_layout_points(username)
    if points is None:
        points = base_embedding_points()
    if username:
        points = merge_current_user_points(points, username)
    points = add_artist_points(points)
    return add_truck_points(points)


def base_embedding_points(request: LayoutRequest | None = None) -> list[dict[str, Any]]:
    """Project base catalog track embeddings into visualization points."""
    rows = latest_embedding_rows(include_user_artists=False)
    pairs = rows_with_vectors(rows)
    if not pairs:
        return []
    projection, clusters = project_and_cluster([vector for _, vector in pairs], request)
    points = []
    for idx, (row, _) in enumerate(pairs):
        points.append(track_point(row, float(projection[idx, 0]), float(projection[idx, 1]), int(clusters[idx])))
    return points


def add_artist_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add synthetic artist centroid points to track visualization points."""
    without_old_artists = [point for point in points if point.get("kind") != "artist"]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for point in without_old_artists:
        if point.get("kind") != "track":
            continue
        artist_name = (point.get("metadata") or {}).get("artist_name")
        if artist_name:
            grouped.setdefault(str(artist_name), []).append(point)

    artist_points = []
    for artist_name, artist_tracks in grouped.items():
        clusters = [int(point.get("cluster", 0)) for point in artist_tracks]
        cluster = max(set(clusters), key=clusters.count) if clusters else 0
        artist_points.append(
            {
                "id": f"artist-{slugify(artist_name)}",
                "kind": "artist",
                "label": artist_name,
                "x": float(np.mean([point["x"] for point in artist_tracks])),
                "y": float(np.mean([point["y"] for point in artist_tracks])),
                "cluster": cluster,
                "metadata": {
                    "artist_name": artist_name,
                    "track_count": len(artist_tracks),
                    "love_mobiles": (artist_tracks[0].get("metadata") or {}).get("love_mobiles") or [],
                    "tracks": [
                        {
                            "id": track["id"],
                            "label": track["label"],
                            "title": (track.get("metadata") or {}).get("title"),
                            "url": (track.get("metadata") or {}).get("url"),
                            "track_id": (track.get("metadata") or {}).get("track_id"),
                        }
                        for track in artist_tracks
                    ],
                },
            }
        )
    return without_old_artists + artist_points


def fetch_love_mobiles_with_artists() -> list[dict[str, Any]]:
    """Load love mobiles with the artist names linked to each truck.

    Returns:
        One dictionary per love mobile with the base love-mobile columns plus
        an ``artist_names`` list gathered from ``artist_love_mobiles``.
    """
    with connect() as conn:
        has_table = conn.execute(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'love_mobiles'"
        ).fetchone()["count"]
        if not has_table:
            return []
    rows = conn.execute(
        """
        SELECT lm.*, alm.artist_name, alm.set_order, alm.set_start, alm.set_end
        FROM love_mobiles lm
        LEFT JOIN artist_love_mobiles alm ON alm.love_mobile_id = lm.id
        ORDER BY lm.source_index, alm.id
        """
    ).fetchall()
    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        data = row_dict(row)
        lm_id = int(data["id"])
        entry = grouped.setdefault(lm_id, {})
        if "artist_names" not in entry:
            entry.update({key: value for key, value in data.items() if key not in ("artist_name", "set_order", "set_start", "set_end")})
            entry["artist_names"] = []
            entry["artist_slots"] = []
        if data.get("artist_name"):
            entry["artist_names"].append(str(data["artist_name"]))
            entry["artist_slots"].append(
                {
                    "name": str(data["artist_name"]),
                    "set_order": data.get("set_order"),
                    "set_start": data.get("set_start"),
                    "set_end": data.get("set_end"),
                }
            )
    for entry in grouped.values():
        entry["artist_names"] = list(dict.fromkeys(entry["artist_names"]))
    return list(grouped.values())


def add_truck_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add synthetic truck (love mobile) points at the mean of their artists.

    Trucks have no embeddings of their own; each truck sits at the centroid of
    the artist points that play on it. Trucks with no artists present on the
    current map are skipped. Because positions are derived from artist points
    every time the payload is built, a t-SNE/PCA recomputation automatically
    repositions the trucks.
    """
    artist_by_name = {point.get("label"): point for point in points if point.get("kind") == "artist"}
    truck_points: list[dict[str, Any]] = []
    for truck in fetch_love_mobiles_with_artists():
        artist_names = [name for name in truck.get("artist_names") or [] if name in artist_by_name]
        artist_points = [artist_by_name[name] for name in artist_names]
        if not artist_points:
            continue
        clusters = [int(point.get("cluster", 0)) for point in artist_points]
        cluster = max(set(clusters), key=clusters.count) if clusters else 0
        tracks: list[dict[str, Any]] = []
        for point in artist_points:
            artist_name = point.get("label")
            for track in (point.get("metadata") or {}).get("tracks") or []:
                tracks.append({**track, "artist_name": artist_name})
        metadata = {
            "id": truck.get("id"),
            "uuid": truck.get("uuid"),
            "source_index": truck.get("source_index"),
            "number": truck.get("number"),
            "name": truck.get("name"),
            "title": truck.get("title"),
            "genres": truck.get("genres"),
            "motto": truck.get("motto"),
            "time": truck.get("time"),
            "description": truck.get("description"),
            "image": json_value(truck.get("image"), {}),
            "links": json_value(truck.get("links"), []),
            "source": truck.get("source"),
            "artist_names": artist_names,
            "artist_slots": truck.get("artist_slots") or [],
            "track_count": len(tracks),
            "tracks": tracks,
        }
        truck_points.append(
            {
                "id": f"truck-{truck.get('uuid') or truck.get('source_index') or truck.get('id')}",
                "kind": "truck",
                "label": truck.get("name") or truck.get("title") or f"Truck {truck.get('number') or ''}".strip(),
                "x": float(np.mean([point["x"] for point in artist_points])),
                "y": float(np.mean([point["y"] for point in artist_points])),
                "cluster": cluster,
                "metadata": metadata,
            }
        )
    return points + truck_points


def merge_current_user_points(points: list[dict[str, Any]], username: str) -> list[dict[str, Any]]:
    """Merge a user's completed submissions into an existing layout."""
    current = {f"user-track-{track['id']}": track for track in list_user_tracks(username) if track.get("status") == "completed"}
    merged = []
    seen = set()
    for point in points:
        if point.get("kind") == "user_track":
            track = current.get(point["id"])
            if track is not None:
                merged.append(
                    user_point_from_track(
                        track,
                        float(point.get("x", 0.0)),
                        float(point.get("y", 0.0)),
                        int(point.get("cluster", -1)),
                        placement_method=(point.get("metadata") or {}).get("placement_method") or "tsne_recomputed",
                    )
                )
                seen.add(point["id"])
            continue
        merged.append(point)
    for point_id, track in current.items():
        if point_id not in seen:
            merged.append(user_point_from_track(track))
    return merged


def user_points(username: str) -> list[dict[str, Any]]:
    """Return visualization points for a user's completed submissions."""
    return [
        user_point_from_track(track)
        for track in list_user_tracks(username)
        if track.get("status") == "completed"
    ]


def recompute_layout(username: str | None = None, request: LayoutRequest | None = None) -> list[dict[str, Any]]:
    """Recompute 2D coordinates and clusters for the visualization.

    Args:
        username: Optional user scope whose completed tracks should be included.
        request: Layout options controlling PCA, t-SNE, clustering, and seed.

    Returns:
        Visualization point dictionaries for tracks and user tracks.
    """
    username = normalize_username(username) if username else None
    rows = latest_embedding_rows(include_user_artists=username is not None)
    if username:
        allowed_track_ids = user_track_ids(username)
        rows = [row for row in rows if not is_user_artist(row["artist_name"]) or int(row["track_id"]) in allowed_track_ids]
    pairs = rows_with_vectors(rows)
    if not pairs:
        return []
    projection, clusters = project_and_cluster([vector for _, vector in pairs], request)
    user_track_map = user_tracks_by_track_id(username) if username else {}
    points = []
    for idx, (row, _) in enumerate(pairs):
        x = float(projection[idx, 0])
        y = float(projection[idx, 1])
        cluster = int(clusters[idx])
        if is_user_artist(row.get("artist_name")) and int(row["track_id"]) in user_track_map:
            points.append(user_point_from_track(user_track_map[int(row["track_id"])], x, y, cluster, placement_method="tsne_recomputed"))
        else:
            points.append(track_point(row, x, y, cluster))
    return points


def save_layout_job(job: LayoutJob, points: list[dict[str, Any]] | None = None) -> None:
    """Persist layout job status and optional completed points."""
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO embedding_layouts (id, username, status, points_json, error, created_at, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job.id,
                job.username,
                job.status,
                json.dumps(points) if points is not None else None,
                job.error,
                job.created_at,
                job.started_at,
                job.finished_at,
            ),
        )


def load_layout_job(job_id: str) -> dict[str, Any] | None:
    """Load a persisted layout job by ID."""
    with connect() as conn:
        row = conn.execute("SELECT id, username, status, error, created_at, started_at, finished_at FROM embedding_layouts WHERE id = ?", (job_id,)).fetchone()
    return row_dict(row) if row else None


def latest_embedding_rows(include_user_artists: bool) -> list[dict[str, Any]]:
    """Load latest embedding rows, optionally including user-submitted artists."""
    data = fetch_latest_embedding_rows()
    base_rows = [row for row in data if not is_user_artist(row["artist_name"])]
    seed_rows = seed_embedding_rows() if not base_rows else []
    if seed_rows:
        data = seed_rows + [row for row in data if is_user_artist(row["artist_name"])]
    if include_user_artists:
        return data
    return [row for row in data if not is_user_artist(row["artist_name"])]


def fetch_latest_embedding_rows(db_file: Path | None = None) -> list[dict[str, Any]]:
    """Fetch the latest embedding row for each track from SQLite.

    Args:
        db_file: Optional SQLite database path; defaults to the configured app
            database.

    Returns:
        Joined embedding rows with track and artist fields.
    """
    if db_file is None:
        conn_context = connect()
    else:
        conn_context = sqlite3.connect(db_file)
        conn_context.row_factory = sqlite3.Row
    with conn_context as conn:
        has_table = conn.execute(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'track_embeddings'"
        ).fetchone()["count"]
        if not has_table:
            return []
        rows = conn.execute(
            """
            SELECT te.*, tracks.id AS track_id, tracks.url, tracks.path, artists.name AS artist_name
            FROM track_embeddings te
            JOIN tracks ON tracks.id = te.track_id
            JOIN artists ON artists.id = te.artist_id
            WHERE te.id = (
                SELECT latest.id FROM track_embeddings latest
                WHERE latest.track_id = te.track_id
                ORDER BY latest.embedded_at DESC, latest.id DESC
                LIMIT 1
            )
            ORDER BY artists.name, tracks.id
            """
        ).fetchall()
        love_mobiles_by_artist = fetch_love_mobiles_by_artist(conn)
    result = [row_dict(row) for row in rows]
    for row in result:
        row["love_mobiles"] = love_mobiles_by_artist.get(int(row["artist_id"]), [])
    return result


def fetch_love_mobiles_by_artist(conn: sqlite3.Connection) -> dict[int, list[dict[str, Any]]]:
    """Load love-mobile metadata keyed by artist ID when the tables exist."""
    has_table = conn.execute(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'artist_love_mobiles'"
    ).fetchone()["count"]
    if not has_table:
        return {}
    rows = conn.execute(
        """
        SELECT
            alm.artist_id,
            alm.artist_name,
            alm.artist_bio,
            alm.artist_links,
            alm.set_order,
            alm.set_start,
            alm.set_end,
            lm.id,
            lm.uuid,
            lm.source_index,
            lm.number,
            lm.name,
            lm.title,
            lm.genres,
            lm.motto,
            lm.time,
            lm.description,
            lm.image,
            lm.links,
            lm.source
        FROM artist_love_mobiles alm
        JOIN love_mobiles lm ON lm.id = alm.love_mobile_id
        ORDER BY alm.artist_id, lm.source_index
        """
    ).fetchall()
    result: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        result.setdefault(int(row["artist_id"]), []).append(
            {
                "id": row["id"],
                "uuid": row["uuid"],
                "source_index": row["source_index"],
                "number": row["number"],
                "name": row["name"],
                "title": row["title"],
                "genres": row["genres"],
                "motto": row["motto"],
                "time": row["time"],
                "description": row["description"],
                "image": json_value(row["image"], {}),
                "links": json_value(row["links"], []),
                "source": row["source"],
                "artist_name": row["artist_name"],
                "artist_bio": row["artist_bio"],
                "artist_links": json_value(row["artist_links"], []),
                "set_order": row["set_order"],
                "set_start": row["set_start"],
                "set_end": row["set_end"],
            }
        )
    return result


def seed_embedding_rows() -> list[dict[str, Any]]:
    """Load fallback base embeddings from ``STREETPARADE_SEED_DB`` if set."""
    raw = os.environ.get("STREETPARADE_SEED_DB")
    if not raw:
        return []
    seed = Path(raw)
    if not seed.exists():
        return []
    try:
        return [row for row in fetch_latest_embedding_rows(seed) if not is_user_artist(row["artist_name"])]
    except sqlite3.Error:
        return []


def is_user_artist(artist_name: str | None) -> bool:
    """Return whether an artist row represents user-submitted tracks."""
    return bool(artist_name and artist_name.startswith(f"{USER_ARTIST_PREFIX}:"))


def user_track_ids(username: str) -> set[int]:
    """Return canonical track IDs linked to a user's submissions."""
    return {int(track["track_id"]) for track in list_user_tracks(username) if track.get("track_id") is not None}


def user_tracks_by_track_id(username: str) -> dict[int, dict[str, Any]]:
    """Index a user's submissions by linked canonical track ID."""
    return {int(track["track_id"]): track for track in list_user_tracks(username) if track.get("track_id") is not None}


def vectors_for_rows(rows: list[dict[str, Any]]) -> dict[str, np.ndarray]:
    """Load ChromaDB vectors for embedding rows by vector ID."""
    store = get_vector_store()
    vectors = {}
    for row in rows:
        vector = store.get_embedding(row["vector_id"])
        if vector is not None:
            vectors[row["vector_id"]] = np.asarray(vector, dtype=np.float32)
    return vectors


def rows_with_vectors(rows: list[dict[str, Any]]) -> list[tuple[dict[str, Any], np.ndarray]]:
    """Pair embedding rows with available vectors, dropping missing vectors."""
    vectors = vectors_for_rows(rows)
    return [(row, vectors[row["vector_id"]]) for row in rows if row["vector_id"] in vectors]


def approximate_user_coordinates(embedding: np.ndarray) -> tuple[float | None, float | None]:
    """Estimate map coordinates from nearest base embedding points."""
    layout = latest_layout_points(None)
    if not layout:
        layout = base_embedding_points()
    base_by_vector = {point["metadata"].get("vector_id"): point for point in layout if point["kind"] == "track"}
    rows = [row for row in latest_embedding_rows(include_user_artists=False) if row["vector_id"] in base_by_vector]
    if not rows:
        return None, None
    vectors = vectors_for_rows(rows)
    ordered = [(row, vectors[row["vector_id"]]) for row in rows if row["vector_id"] in vectors]
    distances = euclidean_distances(np.asarray([embedding], dtype=np.float32), np.vstack([item[1] for item in ordered]))[0]
    nearest = np.argsort(distances)[:5]
    coords = [base_by_vector[ordered[idx][0]["vector_id"]] for idx in nearest]
    return float(np.mean([point["x"] for point in coords])), float(np.mean([point["y"] for point in coords]))


def project_and_cluster(vectors: list[np.ndarray], request: LayoutRequest | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Project high-dimensional vectors to 2D and assign clusters.

    Args:
        vectors: Embedding vectors to lay out.
        request: Optional layout controls for PCA, t-SNE, clustering, and seed.

    Returns:
        Tuple of ``(projection, clusters)`` arrays aligned with ``vectors``.
    """
    if len(vectors) == 1:
        return np.zeros((1, 2), dtype=np.float32), np.zeros(1, dtype=int)
    x = np.vstack(vectors)
    request = request or LayoutRequest()
    pca_x = None
    if request.pca_enabled:
        component_count = min(request.pca_components, x.shape[0], x.shape[1])
        pca_x = PCA(n_components=component_count, random_state=request.random_state).fit_transform(x)
    tsne_x = pca_x if request.pca_enabled and request.tsne_input == "pca" and pca_x is not None else x
    cluster_x = pca_x if request.pca_enabled and request.cluster_input == "pca" and pca_x is not None else x
    automatic_perplexity = min(30.0, max(1.0, (len(vectors) - 1) / 3.0), len(vectors) - 1e-3)
    perplexity = min(request.tsne_perplexity or automatic_perplexity, len(vectors) - 1e-3)
    projection = TSNE(
        n_components=2,
        perplexity=perplexity,
        metric=request.tsne_metric,
        init="random",
        learning_rate=request.tsne_learning_rate,
        random_state=request.random_state,
    ).fit_transform(tsne_x)
    automatic_cluster_count = max(2, round(math.sqrt(len(vectors) / 2)))
    cluster_count = request.cluster_count or automatic_cluster_count
    cluster_count = min(cluster_count, 12 if request.cluster_count is None else cluster_count, len(vectors) - 1)
    if cluster_count <= 1:
        clusters = np.zeros(len(vectors), dtype=int)
    else:
        clusters = SpectralClustering(n_clusters=cluster_count, affinity="rbf", random_state=request.random_state).fit_predict(cluster_x)
    return projection, clusters.astype(int)


def track_point(row: dict[str, Any], x: float, y: float, cluster: int) -> dict[str, Any]:
    """Convert an embedding row into a visualization point."""
    title = title_from_url(row.get("url")) or f"Track {row['track_id']}"
    return {
        "id": f"track-{row['track_id']}",
        "kind": "track" if not is_user_artist(row.get("artist_name")) else "user_track",
        "label": f"{title} - {row.get('artist_name') or 'Unknown'}",
        "x": x,
        "y": y,
        "cluster": cluster,
        "metadata": {
            "track_id": row["track_id"],
            "title": title,
            "artist_name": row.get("artist_name"),
            "url": row.get("url"),
            "path": row.get("path"),
            "vector_id": row.get("vector_id"),
            "embedding_model": row.get("embedding_model"),
            "love_mobiles": row.get("love_mobiles") or [],
        },
    }


def json_value(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def user_point_from_track(
    track: dict[str, Any],
    x: float | None = None,
    y: float | None = None,
    cluster: int = -1,
    placement_method: str | None = None,
) -> dict[str, Any]:
    """Convert a user-track row into a visualization point."""
    method = placement_method or track.get("placement_method")
    return {
        "id": f"user-track-{track['id']}",
        "kind": "user_track",
        "label": track.get("title") or title_from_url(track["source_url"]),
        "x": float(x if x is not None else track.get("x") or 0.0),
        "y": float(y if y is not None else track.get("y") or 0.0),
        "cluster": int(cluster),
        "metadata": {**track, "placement_method": method},
    }


def slugify(value: str) -> str:
    """Create a URL-safe-ish identifier component for an artist label."""
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "artist"


def title_from_url(url: str | None) -> str:
    """Infer a display title from the final path segment of a URL."""
    if not url:
        return "Untitled"
    slug = unquote(urlparse(url).path.strip("/").split("/")[-1])
    cleaned = re.sub(r"[_\-]+", " ", slug).strip()
    return " ".join(part.capitalize() for part in cleaned.split()) if cleaned else "Untitled"


def create_share(username: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Persist a shareable visualization payload for a user."""
    username = normalize_username(username)
    get_user(username)
    token = uuid4().hex
    body = {**payload, "username": username, "submitted_songs": list_user_tracks(username)}
    with connect() as conn:
        conn.execute(
            "INSERT INTO preference_shares (token, username, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (token, username, json.dumps(body), _now()),
        )
    return {"token": token, "username": username, "payload": body}


def get_share(token: str) -> dict[str, Any]:
    """Load a saved visualization share by token.

    Raises:
        HTTPException: If the token does not exist.
    """
    with connect() as conn:
        row = conn.execute("SELECT * FROM preference_shares WHERE token = ?", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="share not found")
    data = row_dict(row)
    data["payload"] = json.loads(data.pop("payload_json"))
    return data
