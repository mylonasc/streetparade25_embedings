from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .app_factory import create_app
from .db import connect as _connect
from .db import init_db
from .routes.catalog import create_artist
from .routes.catalog import get_artist
from .routes.catalog import get_artist_embeddings
from .routes.catalog import get_track_embedding
from .routes.catalog import get_track_samples
from .routes.catalog import health
from .routes.catalog import list_artist_tracks
from .routes.catalog import list_artists
from .routes.catalog import list_track_embeddings
from .routes.catalog import list_tracks
from .routes.catalog import search_similar_track_embeddings
from .routes.jobs import cancel_download_job_response as _cancel_download_job_response
from .routes.jobs import cancel_embedding_job_response as _cancel_embedding_job_response
from .routes.jobs import create_job_router
from .routes.jobs import get_download_job_response as _get_download_job_response
from .routes.jobs import get_embedding_job_response as _get_embedding_job_response
from .routes.jobs import list_download_job_responses as _list_download_job_responses
from .routes.jobs import list_embedding_job_responses as _list_embedding_job_responses
from .routes.jobs import queue_artist_download as _queue_artist_download
from .routes.jobs import queue_embedding_compute as _queue_embedding_compute
from .routes.users import create_share_response as _create_share_response
from .routes.users import create_user_response as _create_user_response
from .routes.users import create_user_router
from .routes.users import get_layout_job_response as _get_layout_job_response
from .routes.users import get_user_track_audio_response as _get_user_track_audio_response
from .routes.users import get_user_track_job_response as _get_user_track_job_response
from .routes.users import get_visualization_response as _get_visualization_response
from .routes.users import list_user_owned_track_responses as _list_user_owned_track_responses
from .routes.users import list_user_preference_responses as _list_user_preference_responses
from .routes.users import recompute_visualization_layout_response as _recompute_visualization_layout_response
from .routes.users import set_user_preference_response as _set_user_preference_response
from .routes.users import submit_user_track_response as _submit_user_track_response
from .runtime import now as _now
from .schemas import ArtistCreate, ComputeRequest, DownloadRequest, LayoutRequest, PreferenceRequest, SimilaritySearchRequest
from .schemas import set_job_clock
from .services.downloads import DownloadService as _DownloadService
from .services.embeddings import LazyClapEmbeddingService as _LazyClapEmbeddingService
from .services.layouts import LayoutService as _LayoutService
from .services.user_tracks import UserTrackAnalysisService as _UserTrackAnalysisService
from .soundcloud import download_track
from .user_visualization import get_share as _get_share
from .user_visualization import get_user as _get_user_profile


set_job_clock(_now)


def song_downloads_and_embeddings_enabled() -> bool:
    """Return whether per-user song downloads and embeddings are enabled."""
    raw = os.environ.get("ENABLE_SONG_DL_AND_EMBEDINGS", "1").strip().lower()
    return raw not in {"0", "false", "no", "off", ""}


def _require_song_downloads_and_embeddings() -> None:
    if not song_downloads_and_embeddings_enabled():
        raise HTTPException(status_code=403, detail="per-user song downloads and embeddings are disabled")


class DownloadService(_DownloadService):
    """Compatibility wrapper that uses ``api.download_track`` at runtime."""

    def __init__(self):
        super().__init__(download_track_func=lambda track_url, output_path: download_track(track_url, output_path))


LazyClapEmbeddingService = _LazyClapEmbeddingService
UserTrackAnalysisService = _UserTrackAnalysisService
LayoutService = _LayoutService


embedding_service: LazyClapEmbeddingService | None = None
download_service: DownloadService | None = None
user_track_analysis_service: UserTrackAnalysisService | None = None
layout_service = LayoutService()


def get_embedding_service() -> LazyClapEmbeddingService:
    """Return the embedding queue service, creating it only when enabled."""
    _require_song_downloads_and_embeddings()
    global embedding_service
    if embedding_service is None:
        embedding_service = LazyClapEmbeddingService()
    return embedding_service


def get_download_service() -> DownloadService:
    """Return the download queue service, creating it only when enabled."""
    _require_song_downloads_and_embeddings()
    global download_service
    if download_service is None:
        download_service = DownloadService()
    return download_service


def get_user_track_analysis_service() -> UserTrackAnalysisService:
    """Return the user-track analysis service, creating it only when enabled."""
    _require_song_downloads_and_embeddings()
    global user_track_analysis_service
    if user_track_analysis_service is None:
        user_track_analysis_service = UserTrackAnalysisService()
    return user_track_analysis_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize storage and background workers for the FastAPI lifespan."""
    init_db()
    if song_downloads_and_embeddings_enabled():
        await get_embedding_service().start()
        await get_download_service().start()
        await get_user_track_analysis_service().start()
    await layout_service.start()
    try:
        yield
    finally:
        await layout_service.stop()
        if user_track_analysis_service is not None:
            await user_track_analysis_service.stop()
        if download_service is not None:
            await download_service.stop()
        if embedding_service is not None:
            await embedding_service.stop()


app = create_app(lifespan=lifespan)
app.include_router(create_job_router(get_download_service, get_embedding_service))
app.include_router(create_user_router(get_user_track_analysis_service, lambda: layout_service, song_downloads_and_embeddings_enabled))


async def download_artist_tracks(artist_id: int, payload: DownloadRequest) -> dict[str, Any]:
    """Queue discovery, download, and sampling for one artist's tracks."""
    return await _queue_artist_download(artist_id, payload, get_download_service())


async def list_download_jobs() -> list[dict[str, Any]]:
    """List queued, running, and completed download jobs."""
    return _list_download_job_responses(get_download_service())


async def get_download_job(job_id: str) -> dict[str, Any]:
    """Return one download job by ID."""
    return _get_download_job_response(job_id, get_download_service())


async def cancel_download_job(job_id: str) -> dict[str, Any]:
    """Request cancellation for a download job."""
    return _cancel_download_job_response(job_id, get_download_service())


async def compute_embeddings(payload: ComputeRequest) -> dict[str, Any]:
    """Queue embedding computation for tracks matching a request."""
    return await _queue_embedding_compute(payload, get_embedding_service())


async def compute_artist_track_embeddings(artist_id: int, payload: ComputeRequest) -> dict[str, Any]:
    """Queue embedding computation for tracks belonging to one artist."""
    request = payload.model_copy(update={"artist_id": artist_id})
    return await compute_embeddings(request)


async def list_embedding_jobs() -> list[dict[str, Any]]:
    """List queued, running, and completed embedding jobs."""
    return _list_embedding_job_responses(get_embedding_service())


async def get_embedding_job(job_id: str) -> dict[str, Any]:
    """Return one embedding job by ID."""
    return _get_embedding_job_response(job_id, get_embedding_service())


async def cancel_embedding_job(job_id: str) -> dict[str, Any]:
    """Request cancellation for an embedding job."""
    return _cancel_embedding_job_response(job_id, get_embedding_service())


async def create_user(payload: dict[str, Any]) -> dict[str, Any]:
    """Create or refresh a public visualization user."""
    return _create_user_response(payload)


async def get_user_profile(username: str) -> dict[str, Any]:
    """Return a public visualization user profile."""
    return _get_user_profile(username)


async def submit_user_track(username: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Queue download and embedding analysis for a user-submitted track."""
    return await _submit_user_track_response(username, payload, get_user_track_analysis_service(), song_downloads_and_embeddings_enabled)


async def list_user_owned_tracks(username: str) -> list[dict[str, Any]]:
    """List tracks submitted by a visualization user."""
    return _list_user_owned_track_responses(username, song_downloads_and_embeddings_enabled)


async def list_user_preferences(username: str) -> dict[str, Any]:
    """Return current non-cleared preferences for a visualization user."""
    return _list_user_preference_responses(username)


async def set_user_preference(username: str, payload: PreferenceRequest) -> dict[str, Any]:
    """Set or clear a visualization preference for a user."""
    return _set_user_preference_response(username, payload)


async def get_user_track_audio(username: str, user_track_id: int) -> FileResponse:
    """Stream cached audio for a user-submitted track."""
    return _get_user_track_audio_response(username, user_track_id, song_downloads_and_embeddings_enabled)


async def get_user_track_job(job_id: str) -> dict[str, Any]:
    """Return one user-track analysis job by ID."""
    return _get_user_track_job_response(job_id, get_user_track_analysis_service(), song_downloads_and_embeddings_enabled)


async def get_visualization(username: str | None = None) -> dict[str, Any]:
    """Return visualization points and feature flags for the map UI."""
    return _get_visualization_response(username, song_downloads_and_embeddings_enabled)


async def recompute_visualization_layout(payload: LayoutRequest) -> dict[str, Any]:
    """Queue recomputation of visualization coordinates and clusters."""
    return await _recompute_visualization_layout_response(payload, layout_service)


async def get_layout_job(job_id: str) -> dict[str, Any]:
    """Return one visualization layout job by ID."""
    return _get_layout_job_response(job_id, layout_service)


async def create_share(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a share token for visualization preferences and tracks."""
    return _create_share_response(payload)


async def get_share(token: str) -> dict[str, Any]:
    """Return a saved visualization share payload by token."""
    return _get_share(token)
