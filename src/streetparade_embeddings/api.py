from __future__ import annotations

import os
import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import Device
from .db import connect as _connect
from .db import db_path as _db_path
from .db import ensure_entity_uuids as _ensure_entity_uuids
from .db import init_db
from .embeddings import ClapEmbeddingModel
from .provenance import config_hash as _config_hash
from .repositories import complete_track_download as _complete_track_download
from .repositories import create_or_update_artist as _create_or_update_artist
from .repositories import fail_track_download as _fail_track_download
from .repositories import get_artist_embeddings as _get_artist_embeddings
from .repositories import get_artist_response as _get_artist_response
from .repositories import get_artist as _get_artist
from .repositories import get_artist_dict as _get_artist_dict
from .repositories import get_track_embedding as _get_track_embedding
from .repositories import get_track_samples as _get_track_samples
from .repositories import list_artist_tracks as _list_artist_tracks
from .repositories import list_artists as _list_artists
from .repositories import list_tracks as _list_tracks
from .repositories import list_track_embeddings as _list_track_embeddings
from .repositories import prepare_track_download as _prepare_track_download
from .repositories import select_embedding_rows as _select_embedding_rows
from .repositories import similarity_search as _similarity_search
from .repositories import store_track_embedding as _store_track_embedding
from .repositories import store_sample_embeddings as _store_sample_embeddings
from .repositories import store_track_error as _store_track_error
from .repositories import validate_artist_download_request as _validate_artist_download_request
from .responses import track_response as _track_response
from .schemas import ArtistCreate, ComputeRequest, DownloadJob, DownloadRequest, EmbeddingJob, LayoutRequest, SimilaritySearchRequest
from .schemas import set_job_clock
from .soundcloud import DiscoveryMethod, discover_track_urls_requests_html, discover_track_urls_sync, download_track
from .user_visualization import LayoutJob, UserTrackJob
from .user_visualization import analyze_user_track as _analyze_user_track
from .user_visualization import create_share as _create_share
from .user_visualization import create_user_track as _create_user_track
from .user_visualization import get_or_create_user as _get_or_create_user
from .user_visualization import get_share as _get_share
from .user_visualization import get_user as _get_user_profile
from .user_visualization import get_user_track_for_username as _get_user_track_for_username
from .user_visualization import latest_layout_points as _latest_layout_points
from .user_visualization import list_user_tracks as _list_user_tracks
from .user_visualization import load_layout_job as _load_layout_job
from .user_visualization import load_user_track_job as _load_user_track_job
from .user_visualization import recompute_layout as _recompute_layout
from .user_visualization import record_user_track_job as _record_user_track_job
from .user_visualization import save_layout_job as _save_layout_job
from .user_visualization import set_user_track_status as _set_user_track_status
from .user_visualization import visualization_points as _visualization_points


def _now() -> str:
    return datetime.now(UTC).isoformat()


set_job_clock(_now)


def _cors_origins() -> list[str]:
    raw = os.environ.get(
        "STREETPARADE_CORS_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:3001,"
        "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:3000,http://127.0.0.1:3001",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _cors_origin_regex() -> str | None:
    return os.environ.get(
        "STREETPARADE_CORS_ORIGIN_REGEX",
        r"https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?",
    )

class LazyClapEmbeddingService:
    """Owns one lazily-loaded CLAP model and an async embedding job queue."""

    def __init__(self, model_cls: type[ClapEmbeddingModel] = ClapEmbeddingModel):
        self.model_cls = model_cls
        self._model: ClapEmbeddingModel | None = None
        self._model_key: tuple[str, str, str | None, Device, str] | None = None
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
                        model = await self._get_model(job.request)
                        if job.request.compute_segment_embeddings:
                            segment_embeddings = await asyncio.to_thread(
                                model.embed_track_segments,
                                row["path"],
                                sampling_rate=job.request.sampling_rate,
                                chunk_seconds=job.request.chunk_seconds,
                                stride_seconds=job.request.chunk_stride_seconds,
                                max_chunks=job.request.max_chunks,
                            )
                            embedding = segment_embeddings.mean(axis=0)
                        else:
                            segment_embeddings = None
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
                    updated = await asyncio.to_thread(_store_track_embedding, row, embedding, job.request, _now)
                    if segment_embeddings is not None:
                        await asyncio.to_thread(_store_sample_embeddings, row, segment_embeddings, job.request, _now)
                except Exception as exc:
                    updated = await asyncio.to_thread(_store_track_error, row["id"], str(exc), _now)
                job.processed.append(_track_response(updated))

            job.status = "completed"
            job.finished_at = _now()
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = _now()

    async def _get_model(self, request: ComputeRequest) -> ClapEmbeddingModel:
        if request.embedding_backend != "clap":
            raise ValueError(f"unsupported embedding backend: {request.embedding_backend}")
        key = (
            request.embedding_backend,
            request.model_name,
            request.model_revision,
            request.device,
            _config_hash(request.model_options),
        )
        if self._model is None or self._model_key != key:
            self._model = await asyncio.to_thread(self.model_cls, model_name=request.model_name, device=request.device)
            self._model_key = key
        return self._model


class DownloadService:
    """Process SoundCloud downloads in a background queue."""

    def __init__(self):
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._jobs: dict[str, DownloadJob] = {}
        self._worker: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="download-worker")

    async def stop(self) -> None:
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None

    async def enqueue(self, artist_id: int, request: DownloadRequest) -> DownloadJob:
        await self.start()
        job = DownloadJob(id=uuid4().hex, artist_id=artist_id, request=request)
        self._jobs[job.id] = job
        await self._queue.put(job.id)
        return job

    def get_job(self, job_id: str) -> DownloadJob | None:
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[DownloadJob]:
        return sorted(self._jobs.values(), key=lambda job: job.created_at, reverse=True)

    def cancel(self, job_id: str) -> DownloadJob | None:
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

    async def _process(self, job: DownloadJob) -> None:
        job.status = "running"
        job.started_at = _now()
        failures = 0
        try:
            artist = await asyncio.to_thread(_get_artist_dict, job.artist_id)
            job.phase = "discovering"
            if job.request.track_urls is None:
                soundcloud_url = artist.get("soundcloud_url")
                if not soundcloud_url:
                    raise RuntimeError("artist has no soundcloud_url and no track_urls were supplied")
                track_urls = await _discover_artist_track_urls(soundcloud_url, job.request.discovery_method)
            else:
                track_urls = job.request.track_urls

            track_urls = track_urls[: job.request.max_tracks]
            job.total = len(track_urls)
            job.phase = "downloading"

            for track_url in track_urls:
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = _now()
                    return

                prepared = await asyncio.to_thread(
                    _prepare_track_download,
                    job.artist_id,
                    artist["name"],
                    track_url,
                    job.request.cache_dir,
                    _now,
                )
                try:
                    download = await asyncio.to_thread(download_track, track_url, Path(prepared["path"]))
                    if not Path(download.path).exists():
                        raise FileNotFoundError(f"download completed but file is missing: {download.path}")
                    updated = await asyncio.to_thread(_complete_track_download, prepared["id"], download.path, job.request, _now)
                except Exception as exc:
                    failures += 1
                    updated = await asyncio.to_thread(_fail_track_download, prepared["id"], prepared["path"], str(exc), _now)
                job.processed.append(_track_response(updated))
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = _now()
                    return

            if failures == 0:
                job.status = "completed"
            elif failures == len(track_urls):
                job.status = "failed"
                job.error = "all track downloads failed"
            else:
                job.status = "completed_with_errors"
                job.error = f"{failures} track downloads failed"
            job.finished_at = _now()
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = _now()
        finally:
            job.phase = None


async def _discover_artist_track_urls(soundcloud_url: str, method: DiscoveryMethod) -> list[str]:
    if method is DiscoveryMethod.REQUESTS_HTML:
        try:
            return await discover_track_urls_requests_html(soundcloud_url)
        except Exception:
            return await asyncio.to_thread(discover_track_urls_sync, soundcloud_url, method=DiscoveryMethod.YT_DLP)
    return await asyncio.to_thread(discover_track_urls_sync, soundcloud_url, method=method)


embedding_service = LazyClapEmbeddingService()
download_service = DownloadService()


class UserTrackAnalysisService:
    def __init__(self, model_cls: type[ClapEmbeddingModel] = ClapEmbeddingModel):
        self.model_cls = model_cls
        self._model: ClapEmbeddingModel | None = None
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._jobs: dict[str, UserTrackJob] = {}
        self._worker: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="user-track-analysis-worker")

    async def stop(self) -> None:
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None

    async def enqueue(self, user_track_id: int) -> UserTrackJob:
        await self.start()
        job = UserTrackJob(id=uuid4().hex, user_track_id=user_track_id)
        self._jobs[job.id] = job
        _record_user_track_job(job)
        await self._queue.put(job.id)
        return job

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        return job.as_dict() if job else _load_user_track_job(job_id)

    async def _run(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs[job_id]
            try:
                await self._process(job)
            finally:
                self._queue.task_done()

    async def _process(self, job: UserTrackJob) -> None:
        request = ComputeRequest(only_missing=False)
        job.status = "running"
        job.phase = "analyzing"
        job.started_at = _now()
        _record_user_track_job(job)
        try:
            async with self._lock:
                if self._model is None:
                    self._model = await asyncio.to_thread(self.model_cls, model_name=request.model_name, device=request.device)
                await asyncio.to_thread(_analyze_user_track, job.user_track_id, self._model, request)
            job.status = "completed"
            job.phase = None
            job.finished_at = _now()
        except Exception as exc:
            job.status = "failed"
            job.phase = None
            job.error = str(exc)
            job.finished_at = _now()
            await asyncio.to_thread(_set_user_track_status, job.user_track_id, "failed", error=str(exc))
        _record_user_track_job(job)


class LayoutService:
    def __init__(self):
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._jobs: dict[str, LayoutJob] = {}
        self._worker: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name="layout-worker")

    async def stop(self) -> None:
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None

    async def enqueue(self, request: LayoutRequest) -> LayoutJob:
        await self.start()
        job = LayoutJob(id=uuid4().hex, username=request.username, request=request)
        self._jobs[job.id] = job
        _save_layout_job(job)
        await self._queue.put(job.id)
        return job

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        job = self._jobs.get(job_id)
        return job.as_dict() if job else _load_layout_job(job_id)

    async def _run(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs[job_id]
            try:
                await self._process(job)
            finally:
                self._queue.task_done()

    async def _process(self, job: LayoutJob) -> None:
        job.status = "running"
        job.started_at = _now()
        _save_layout_job(job)
        try:
            points = await asyncio.to_thread(_recompute_layout, job.username, job.request)
            job.status = "completed"
            job.finished_at = _now()
            _save_layout_job(job, points=points)
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = _now()
            _save_layout_job(job)


user_track_analysis_service = UserTrackAnalysisService()
layout_service = LayoutService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    await embedding_service.start()
    await download_service.start()
    await user_track_analysis_service.start()
    await layout_service.start()
    try:
        yield
    finally:
        await layout_service.stop()
        await user_track_analysis_service.stop()
        await download_service.stop()
        await embedding_service.stop()


app = FastAPI(title="Street Parade Embeddings API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=_cors_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "database": str(_db_path())}


@app.post("/artists")
async def create_artist(payload: ArtistCreate) -> dict[str, Any]:
    init_db()
    return _create_or_update_artist(payload, _now)


@app.get("/artists")
async def list_artists() -> list[dict[str, Any]]:
    init_db()
    return _list_artists()


@app.get("/artists/{artist_id}")
async def get_artist(artist_id: int) -> dict[str, Any]:
    init_db()
    return _get_artist_response(artist_id)


@app.get("/artists/{artist_id}/tracks")
async def list_artist_tracks(artist_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    init_db()
    return _list_artist_tracks(artist_id, include_embedding=include_embedding)


@app.get("/tracks")
async def list_tracks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1),
    include_embedding: bool = False,
) -> dict[str, Any]:
    init_db()
    return _list_tracks(page=page, page_size=page_size, include_embedding=include_embedding)


@app.post("/artists/{artist_id}/download")
async def download_artist_tracks(artist_id: int, payload: DownloadRequest) -> dict[str, Any]:
    init_db()
    _validate_artist_download_request(artist_id, payload)
    job = await download_service.enqueue(artist_id, payload)
    return job.as_dict()


@app.get("/download-jobs")
async def list_download_jobs() -> list[dict[str, Any]]:
    return [job.as_dict() for job in download_service.list_jobs()]


@app.get("/download-jobs/{job_id}")
async def get_download_job(job_id: str) -> dict[str, Any]:
    job = download_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="download job not found")
    return job.as_dict()


@app.post("/download-jobs/{job_id}/cancel")
async def cancel_download_job(job_id: str) -> dict[str, Any]:
    job = download_service.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="download job not found")
    return job.as_dict()


@app.get("/tracks/{track_id}/samples")
async def get_track_samples(track_id: int) -> list[dict[str, Any]]:
    init_db()
    return _get_track_samples(track_id)


@app.get("/tracks/{track_id}/embeddings")
async def list_track_embeddings(track_id: int, include_embedding: bool = False) -> list[dict[str, Any]]:
    init_db()
    return _list_track_embeddings(track_id, include_embedding=include_embedding)


@app.post("/similarity/track-embeddings")
async def search_similar_track_embeddings(payload: SimilaritySearchRequest) -> dict[str, Any]:
    init_db()
    return {"results": _similarity_search(payload)}


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
    return _get_track_embedding(track_id)


@app.get("/artists/{artist_id}/embeddings")
async def get_artist_embeddings(artist_id: int, include_tracks: bool = Query(default=True)) -> dict[str, Any]:
    init_db()
    return _get_artist_embeddings(artist_id, include_tracks=include_tracks)


@app.post("/users")
async def create_user(payload: dict[str, Any]) -> dict[str, Any]:
    return _get_or_create_user(str(payload.get("username", "")))


@app.get("/users/{username}")
async def get_user_profile(username: str) -> dict[str, Any]:
    return _get_user_profile(username)


@app.post("/users/{username}/tracks")
async def submit_user_track(username: str, payload: dict[str, Any]) -> dict[str, Any]:
    track = _create_user_track(username, str(payload.get("url", "")))
    job = await user_track_analysis_service.enqueue(int(track["id"]))
    return {"track": track, "job": job.as_dict()}


@app.get("/users/{username}/tracks")
async def list_user_owned_tracks(username: str) -> list[dict[str, Any]]:
    return _list_user_tracks(username)


@app.get("/users/{username}/tracks/{user_track_id}/audio")
async def get_user_track_audio(username: str, user_track_id: int) -> FileResponse:
    track = _get_user_track_for_username(username, user_track_id)
    path = track.get("path")
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="cached audio not found")
    return FileResponse(path, media_type="audio/mpeg")


@app.get("/user-track-jobs/{job_id}")
async def get_user_track_job(job_id: str) -> dict[str, Any]:
    job = user_track_analysis_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="user track job not found")
    return job


@app.get("/visualization")
async def get_visualization(username: str | None = None) -> dict[str, Any]:
    if username:
        _get_or_create_user(username)
    points = _visualization_points(username)
    return {
        "username": username,
        "points": points,
        "point_count": len(points),
        "base_point_count": sum(1 for point in points if point.get("kind") == "track"),
        "artist_point_count": sum(1 for point in points if point.get("kind") == "artist"),
        "user_point_count": sum(1 for point in points if point.get("kind") == "user_track"),
        "has_cached_layout": _latest_layout_points(username) is not None,
    }


@app.post("/layouts/recompute")
async def recompute_visualization_layout(payload: LayoutRequest) -> dict[str, Any]:
    job = await layout_service.enqueue(payload)
    return job.as_dict()


@app.get("/layout-jobs/{job_id}")
async def get_layout_job(job_id: str) -> dict[str, Any]:
    job = layout_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="layout job not found")
    return job


@app.post("/shares")
async def create_share(payload: dict[str, Any]) -> dict[str, Any]:
    return _create_share(str(payload.get("username", "")), payload)


@app.get("/shares/{token}")
async def get_share(token: str) -> dict[str, Any]:
    return _get_share(token)
