from __future__ import annotations

import os
import sqlite3
import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from .audio import DEFAULT_SAMPLING_RATE, preprocess_track
from .config import Device
from .embeddings import ClapEmbeddingModel, aggregate_embeddings
from .soundcloud import ArtistData, DiscoveryMethod, discover_track_urls_sync


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _db_path() -> Path:
    return Path(os.environ.get("STREETPARADE_DB", "streetparade_embeddings.sqlite3"))


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS artists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                links TEXT NOT NULL DEFAULT '[]',
                images TEXT NOT NULL DEFAULT '[]',
                soundcloud_url TEXT,
                instagram TEXT,
                youtube TEXT,
                web TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                path TEXT,
                downloaded INTEGER NOT NULL DEFAULT 0,
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
            """
        )
        _ensure_artist_columns(conn)


def _ensure_artist_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(artists)")}
    migrations = {
        "links": "ALTER TABLE artists ADD COLUMN links TEXT NOT NULL DEFAULT '[]'",
        "images": "ALTER TABLE artists ADD COLUMN images TEXT NOT NULL DEFAULT '[]'",
        "instagram": "ALTER TABLE artists ADD COLUMN instagram TEXT",
        "youtube": "ALTER TABLE artists ADD COLUMN youtube TEXT",
        "web": "ALTER TABLE artists ADD COLUMN web TEXT",
    }
    for column, statement in migrations.items():
        if column not in columns:
            conn.execute(statement)


def _row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    loaded = json.loads(value)
    if not isinstance(loaded, list):
        return []
    return [str(item) for item in loaded]


def _artist_response(row: sqlite3.Row) -> dict[str, Any]:
    result = _row_dict(row)
    result["links"] = _json_list(result.get("links"))
    result["images"] = _json_list(result.get("images"))
    return result


def _embedding_to_blob(embedding: np.ndarray) -> bytes:
    return np.asarray(embedding, dtype=np.float32).tobytes()


def _embedding_from_blob(blob: bytes | None) -> list[float] | None:
    if blob is None:
        return None
    return np.frombuffer(blob, dtype=np.float32).astype(float).tolist()


def _track_response(row: sqlite3.Row, include_embedding: bool = False) -> dict[str, Any]:
    result = _row_dict(row)
    result["downloaded"] = bool(result["downloaded"])
    result["has_embedding"] = result.pop("embedding") is not None
    if include_embedding:
        result["embedding"] = _embedding_from_blob(row["embedding"])
    return result


def _get_artist(conn: sqlite3.Connection, artist_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="artist not found")
    return row


def _upsert_track(conn: sqlite3.Connection, artist_id: int, url: str, path: str | None = None, downloaded: bool = False) -> int:
    now = _now()
    conn.execute(
        """
        INSERT INTO tracks (artist_id, url, path, downloaded, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(artist_id, url) DO UPDATE SET
            path = COALESCE(excluded.path, tracks.path),
            downloaded = CASE WHEN excluded.downloaded THEN 1 ELSE tracks.downloaded END,
            updated_at = excluded.updated_at
        """,
        (artist_id, url, path, int(downloaded), now, now),
    )
    return int(conn.execute("SELECT id FROM tracks WHERE artist_id = ? AND url = ?", (artist_id, url)).fetchone()["id"])


def _record_samples(
    conn: sqlite3.Connection,
    track_id: int,
    path: str | Path,
    sampling_rate: int,
    chunk_seconds: int,
    chunk_stride_seconds: int,
    max_chunks: int,
) -> int:
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
        (len(chunks), sampling_rate, chunk_seconds, chunk_stride_seconds, max_chunks, _now(), track_id),
    )
    return len(chunks)


class ArtistCreate(BaseModel):
    name: str = Field(min_length=1)
    links: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)
    soundcloud_url: str | None = None
    instagram: str | None = None
    youtube: str | None = None
    web: str | None = None


class DownloadRequest(BaseModel):
    max_tracks: int = Field(default=5, ge=1)
    track_urls: list[str] | None = None
    discovery_method: DiscoveryMethod = DiscoveryMethod.YT_DLP
    cache_dir: str = ".songs_cache"
    sampling_rate: int = DEFAULT_SAMPLING_RATE
    chunk_seconds: int = Field(default=30, ge=1)
    chunk_stride_seconds: int = Field(default=60, ge=1)
    max_chunks: int = Field(default=10, ge=1)


class ComputeRequest(BaseModel):
    artist_id: int | None = None
    only_missing: bool = True
    model_name: str = "laion/clap-htsat-unfused"
    device: Device = Device.AUTO
    sampling_rate: int = DEFAULT_SAMPLING_RATE
    chunk_seconds: int = Field(default=30, ge=1)
    chunk_stride_seconds: int = Field(default=60, ge=1)
    max_chunks: int = Field(default=10, ge=1)
    max_tracks: int | None = Field(default=None, ge=1)


@dataclass
class EmbeddingJob:
    id: str
    request: ComputeRequest
    status: str = "queued"
    processed: list[dict[str, Any]] = field(default_factory=list)
    total: int | None = None
    error: str | None = None
    cancel_requested: bool = False
    created_at: str = field(default_factory=_now)
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "processed": self.processed,
            "processed_count": len(self.processed),
            "total": self.total,
            "error": self.error,
            "cancel_requested": self.cancel_requested,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "request": self.request.model_dump(mode="json"),
        }


class LazyClapEmbeddingService:
    """Owns one lazily-loaded CLAP model and an async embedding job queue."""

    def __init__(self, model_cls: type[ClapEmbeddingModel] = ClapEmbeddingModel):
        self.model_cls = model_cls
        self._model: ClapEmbeddingModel | None = None
        self._model_key: tuple[str, Device] | None = None
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._jobs: dict[str, EmbeddingJob] = {}
        self._worker: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="embedding-worker")

    async def stop(self) -> None:
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None

    async def enqueue(self, request: ComputeRequest) -> EmbeddingJob:
        await self.start()
        job = EmbeddingJob(id=uuid4().hex, request=request)
        self._jobs[job.id] = job
        await self._queue.put(job.id)
        return job

    def get_job(self, job_id: str) -> EmbeddingJob | None:
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[EmbeddingJob]:
        return sorted(self._jobs.values(), key=lambda job: job.created_at, reverse=True)

    def cancel(self, job_id: str) -> EmbeddingJob | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        if job.status == "queued":
            job.status = "cancelled"
            job.cancel_requested = True
            job.finished_at = _now()
        elif job.status == "running":
            job.status = "cancelling"
            job.cancel_requested = True
        return job

    async def _run(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs[job_id]
            try:
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = _now()
                    continue
                await self._process(job)
            finally:
                self._queue.task_done()

    async def _process(self, job: EmbeddingJob) -> None:
        job.status = "running"
        job.started_at = _now()
        try:
            rows = await asyncio.to_thread(_select_embedding_rows, job.request)
            job.total = len(rows)
            if not rows:
                job.status = "completed"
                job.finished_at = _now()
                return

            for row in rows:
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = _now()
                    return

                try:
                    async with self._lock:
                        model = await self._get_model(job.request.model_name, job.request.device)
                        embedding = await asyncio.to_thread(
                            model.embed_track,
                            row["path"],
                            sampling_rate=job.request.sampling_rate,
                            chunk_seconds=job.request.chunk_seconds,
                            stride_seconds=job.request.chunk_stride_seconds,
                            max_chunks=job.request.max_chunks,
                        )
                    if job.cancel_requested:
                        job.status = "cancelled"
                        job.finished_at = _now()
                        return
                    updated = await asyncio.to_thread(_store_track_embedding, row["id"], embedding, job.request)
                except Exception as exc:
                    updated = await asyncio.to_thread(_store_track_error, row["id"], str(exc))
                job.processed.append(_track_response(updated))

            job.status = "completed"
            job.finished_at = _now()
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = _now()

    async def _get_model(self, model_name: str, device: Device) -> ClapEmbeddingModel:
        key = (model_name, device)
        if self._model is None or self._model_key != key:
            self._model = await asyncio.to_thread(self.model_cls, model_name=model_name, device=device)
            self._model_key = key
        return self._model


def _select_embedding_rows(payload: ComputeRequest) -> list[dict[str, Any]]:
    where = ["path IS NOT NULL"]
    params: list[Any] = []
    if payload.artist_id is not None:
        where.append("artist_id = ?")
        params.append(payload.artist_id)
    if payload.only_missing:
        where.append("embedding IS NULL")

    query = f"SELECT * FROM tracks WHERE {' AND '.join(where)} ORDER BY artist_id, id"
    if payload.max_tracks is not None:
        query += " LIMIT ?"
        params.append(payload.max_tracks)

    with _connect() as conn:
        if payload.artist_id is not None:
            _get_artist(conn, payload.artist_id)
        return [_row_dict(row) for row in conn.execute(query, params).fetchall()]


def _store_track_embedding(track_id: int, embedding: np.ndarray, payload: ComputeRequest) -> sqlite3.Row:
    with _connect() as conn:
        now = _now()
        conn.execute(
            """
            UPDATE tracks
            SET embedding = ?, embedding_dim = ?, embedding_model = ?, embedded_at = ?, last_error = NULL,
                sampling_rate = ?, chunk_seconds = ?, chunk_stride_seconds = ?, max_chunks = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                _embedding_to_blob(embedding),
                int(embedding.shape[0]),
                payload.model_name,
                now,
                payload.sampling_rate,
                payload.chunk_seconds,
                payload.chunk_stride_seconds,
                payload.max_chunks,
                now,
                track_id,
            ),
        )
        return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()


def _store_track_error(track_id: int, error: str) -> sqlite3.Row:
    with _connect() as conn:
        conn.execute("UPDATE tracks SET last_error = ?, updated_at = ? WHERE id = ?", (error, _now(), track_id))
        return conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()


embedding_service = LazyClapEmbeddingService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    await embedding_service.start()
    try:
        yield
    finally:
        await embedding_service.stop()


app = FastAPI(title="Street Parade Embeddings API", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "database": str(_db_path())}


@app.post("/artists")
async def create_artist(payload: ArtistCreate) -> dict[str, Any]:
    init_db()
    now = _now()
    update_links = "links" in payload.model_fields_set
    update_images = "images" in payload.model_fields_set
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO artists (
                name, links, images, soundcloud_url, instagram, youtube, web, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                links = CASE WHEN ? THEN excluded.links ELSE artists.links END,
                images = CASE WHEN ? THEN excluded.images ELSE artists.images END,
                soundcloud_url = COALESCE(excluded.soundcloud_url, artists.soundcloud_url),
                instagram = COALESCE(excluded.instagram, artists.instagram),
                youtube = COALESCE(excluded.youtube, artists.youtube),
                web = COALESCE(excluded.web, artists.web),
                updated_at = excluded.updated_at
            """,
            (
                payload.name,
                json.dumps(payload.links),
                json.dumps(payload.images),
                payload.soundcloud_url,
                payload.instagram,
                payload.youtube,
                payload.web,
                now,
                now,
                update_links,
                update_images,
            ),
        )
        return _artist_response(conn.execute("SELECT * FROM artists WHERE name = ?", (payload.name,)).fetchone())


@app.get("/artists")
async def list_artists() -> list[dict[str, Any]]:
    init_db()
    with _connect() as conn:
        return [_artist_response(row) for row in conn.execute("SELECT * FROM artists ORDER BY name")]


@app.get("/artists/{artist_id}")
async def get_artist(artist_id: int) -> dict[str, Any]:
    init_db()
    with _connect() as conn:
        return _artist_response(_get_artist(conn, artist_id))


@app.get("/artists/{artist_id}/tracks")
async def list_artist_tracks(artist_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    init_db()
    with _connect() as conn:
        _get_artist(conn, artist_id)
        rows = conn.execute("SELECT * FROM tracks WHERE artist_id = ? ORDER BY id", (artist_id,)).fetchall()
        return [_track_response(row, include_embedding=include_embedding) for row in rows]


@app.post("/artists/{artist_id}/download")
async def download_artist_tracks(artist_id: int, payload: DownloadRequest) -> dict[str, Any]:
    init_db()
    with _connect() as conn:
        artist = _get_artist(conn, artist_id)
        if payload.track_urls is None:
            if not artist["soundcloud_url"]:
                raise HTTPException(status_code=400, detail="artist has no soundcloud_url and no track_urls were supplied")
            track_urls = await asyncio.to_thread(
                discover_track_urls_sync,
                artist["soundcloud_url"],
                method=payload.discovery_method,
            )
        else:
            track_urls = payload.track_urls

        track_urls = track_urls[: payload.max_tracks]
        downloads = await asyncio.to_thread(
            ArtistData(artist["name"], track_urls, cache_folder=payload.cache_dir).download_links,
            num_links=payload.max_tracks,
        )
        response_tracks = []
        for download in downloads:
            track_id = _upsert_track(conn, artist_id, download.url, str(download.path), download.downloaded)
            try:
                _record_samples(
                    conn,
                    track_id,
                    download.path,
                    payload.sampling_rate,
                    payload.chunk_seconds,
                    payload.chunk_stride_seconds,
                    payload.max_chunks,
                )
            except Exception as exc:
                conn.execute("UPDATE tracks SET last_error = ?, updated_at = ? WHERE id = ?", (str(exc), _now(), track_id))
            row = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
            response_tracks.append(_track_response(row))

        return {"artist": _artist_response(artist), "tracks": response_tracks}


@app.get("/tracks/{track_id}/samples")
async def get_track_samples(track_id: int) -> list[dict[str, Any]]:
    init_db()
    with _connect() as conn:
        if conn.execute("SELECT id FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="track not found")
        rows = conn.execute("SELECT * FROM track_samples WHERE track_id = ? ORDER BY chunk_index", (track_id,)).fetchall()
        return [_row_dict(row) for row in rows]


@app.post("/embeddings/compute")
async def compute_embeddings(payload: ComputeRequest) -> dict[str, Any]:
    init_db()
    if payload.artist_id is not None:
        with _connect() as conn:
            _get_artist(conn, payload.artist_id)
    job = await embedding_service.enqueue(payload)
    return job.as_dict()


@app.post("/artists/{artist_id}/embeddings/compute")
async def compute_artist_track_embeddings(artist_id: int, payload: ComputeRequest) -> dict[str, Any]:
    request = payload.model_copy(update={"artist_id": artist_id})
    return await compute_embeddings(request)


@app.get("/embedding-jobs")
async def list_embedding_jobs() -> list[dict[str, Any]]:
    return [job.as_dict() for job in embedding_service.list_jobs()]


@app.get("/embedding-jobs/{job_id}")
async def get_embedding_job(job_id: str) -> dict[str, Any]:
    job = embedding_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="embedding job not found")
    return job.as_dict()


@app.post("/embedding-jobs/{job_id}/cancel")
async def cancel_embedding_job(job_id: str) -> dict[str, Any]:
    job = embedding_service.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="embedding job not found")
    return job.as_dict()


@app.get("/tracks/{track_id}/embedding")
async def get_track_embedding(track_id: int) -> dict[str, Any]:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="track not found")
        if row["embedding"] is None:
            raise HTTPException(status_code=404, detail="track embedding not computed")
        return _track_response(row, include_embedding=True)


@app.get("/artists/{artist_id}/embeddings")
async def get_artist_embeddings(artist_id: int, include_tracks: bool = Query(default=True)) -> dict[str, Any]:
    init_db()
    with _connect() as conn:
        artist = _get_artist(conn, artist_id)
        rows = conn.execute(
            "SELECT * FROM tracks WHERE artist_id = ? AND embedding IS NOT NULL ORDER BY id",
            (artist_id,),
        ).fetchall()
        vectors = [np.frombuffer(row["embedding"], dtype=np.float32) for row in rows]
        average = aggregate_embeddings(vectors)
        result: dict[str, Any] = {
            "artist": _artist_response(artist),
            "track_count": len(rows),
            "average_embedding": average.astype(float).tolist() if average is not None else None,
        }
        if include_tracks:
            result["tracks"] = [_track_response(row, include_embedding=True) for row in rows]
        return result
