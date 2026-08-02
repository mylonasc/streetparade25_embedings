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
    id: str
    user_track_id: int
    status: str = "queued"
    phase: str | None = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: _now())
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class LayoutJob:
    id: str
    username: str | None
    request: LayoutRequest = field(default_factory=LayoutRequest)
    status: str = "queued"
    error: str | None = None
    created_at: str = field(default_factory=lambda: _now())
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        data = self.__dict__.copy()
        data["request"] = self.request.model_dump(mode="json")
        return data


def _now() -> str:
    return datetime.now(UTC).isoformat()


def normalize_username(username: str) -> str:
    value = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{1,62}", value):
        raise HTTPException(status_code=400, detail="username must be 2-63 chars: letters, numbers, _, ., -")
    return value


def source_type(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "soundcloud.com" in host:
        return "soundcloud"
    if "youtube.com" in host or "youtu.be" in host:
        return "youtube"
    raise HTTPException(status_code=400, detail="only SoundCloud and YouTube URLs are supported")


def get_or_create_user(username: str, now: Callable[[], str] = _now) -> dict[str, Any]:
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
    init_db()
    username = normalize_username(username)
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user not found")
    return row_dict(row)


def create_user_track(username: str, url: str, now: Callable[[], str] = _now) -> dict[str, Any]:
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
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO user_track_jobs (id, user_track_id, status, phase, error, created_at, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (job.id, job.user_track_id, job.status, job.phase, job.error, job.created_at, job.started_at, job.finished_at),
        )


def load_user_track_job(job_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM user_track_jobs WHERE id = ?", (job_id,)).fetchone()
    return row_dict(row) if row else None


def user_track_response(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    data = row_dict(row)
    if data.get("x") is not None:
        data["x"] = float(data["x"])
    if data.get("y") is not None:
        data["y"] = float(data["y"])
    return data


def row_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return dict(row)


def analyze_user_track(user_track_id: int, model: ClapEmbeddingModel, request: ComputeRequest) -> dict[str, Any]:
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
    points = latest_layout_points(username)
    if points is None:
        points = base_embedding_points()
    if username:
        points = merge_current_user_points(points, username)
    return add_artist_points(points)


def base_embedding_points(request: LayoutRequest | None = None) -> list[dict[str, Any]]:
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


def merge_current_user_points(points: list[dict[str, Any]], username: str) -> list[dict[str, Any]]:
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
    return [
        user_point_from_track(track)
        for track in list_user_tracks(username)
        if track.get("status") == "completed"
    ]


def recompute_layout(username: str | None = None, request: LayoutRequest | None = None) -> list[dict[str, Any]]:
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
    with connect() as conn:
        row = conn.execute("SELECT id, username, status, error, created_at, started_at, finished_at FROM embedding_layouts WHERE id = ?", (job_id,)).fetchone()
    return row_dict(row) if row else None


def latest_embedding_rows(include_user_artists: bool) -> list[dict[str, Any]]:
    data = fetch_latest_embedding_rows()
    base_rows = [row for row in data if not is_user_artist(row["artist_name"])]
    seed_rows = seed_embedding_rows() if not base_rows else []
    if seed_rows:
        data = seed_rows + [row for row in data if is_user_artist(row["artist_name"])]
    if include_user_artists:
        return data
    return [row for row in data if not is_user_artist(row["artist_name"])]


def fetch_latest_embedding_rows(db_file: Path | None = None) -> list[dict[str, Any]]:
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
    return [row_dict(row) for row in rows]


def seed_embedding_rows() -> list[dict[str, Any]]:
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
    return bool(artist_name and artist_name.startswith(f"{USER_ARTIST_PREFIX}:"))


def user_track_ids(username: str) -> set[int]:
    return {int(track["track_id"]) for track in list_user_tracks(username) if track.get("track_id") is not None}


def user_tracks_by_track_id(username: str) -> dict[int, dict[str, Any]]:
    return {int(track["track_id"]): track for track in list_user_tracks(username) if track.get("track_id") is not None}


def vectors_for_rows(rows: list[dict[str, Any]]) -> dict[str, np.ndarray]:
    store = get_vector_store()
    vectors = {}
    for row in rows:
        vector = store.get_embedding(row["vector_id"])
        if vector is not None:
            vectors[row["vector_id"]] = np.asarray(vector, dtype=np.float32)
    return vectors


def rows_with_vectors(rows: list[dict[str, Any]]) -> list[tuple[dict[str, Any], np.ndarray]]:
    vectors = vectors_for_rows(rows)
    return [(row, vectors[row["vector_id"]]) for row in rows if row["vector_id"] in vectors]


def approximate_user_coordinates(embedding: np.ndarray) -> tuple[float | None, float | None]:
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
        },
    }


def user_point_from_track(
    track: dict[str, Any],
    x: float | None = None,
    y: float | None = None,
    cluster: int = -1,
    placement_method: str | None = None,
) -> dict[str, Any]:
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
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "artist"


def title_from_url(url: str | None) -> str:
    if not url:
        return "Untitled"
    slug = unquote(urlparse(url).path.strip("/").split("/")[-1])
    cleaned = re.sub(r"[_\-]+", " ", slug).strip()
    return " ".join(part.capitalize() for part in cleaned.split()) if cleaned else "Untitled"


def create_share(username: str, payload: dict[str, Any]) -> dict[str, Any]:
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
    with connect() as conn:
        row = conn.execute("SELECT * FROM preference_shares WHERE token = ?", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="share not found")
    data = row_dict(row)
    data["payload"] = json.loads(data.pop("payload_json"))
    return data
