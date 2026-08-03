from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..db import init_db
from ..preferences import current_preferences, set_preference
from ..runtime import now
from ..schemas import LayoutRequest, PreferenceRequest
from ..user_visualization import create_share as _create_share
from ..user_visualization import create_user_track as _create_user_track
from ..user_visualization import get_or_create_user
from ..user_visualization import get_share as _get_share
from ..user_visualization import get_user
from ..user_visualization import get_user_track_for_username
from ..user_visualization import latest_layout_points
from ..user_visualization import list_user_tracks
from ..user_visualization import visualization_points


class JobLike(Protocol):
    """Protocol for jobs returned by user-facing background services."""

    def as_dict(self) -> dict[str, Any]:
        """Serialize the job for API responses."""


class UserTrackAnalysisServiceProtocol(Protocol):
    """Protocol for user-track analysis queue services."""

    async def enqueue(self, user_track_id: int) -> JobLike: ...
    def get_job(self, job_id: str) -> dict[str, Any] | None: ...


class LayoutServiceProtocol(Protocol):
    """Protocol for visualization layout queue services."""

    async def enqueue(self, request: LayoutRequest) -> JobLike: ...
    def get_job(self, job_id: str) -> dict[str, Any] | None: ...


def create_user_router(
    user_track_analysis_service: Callable[[], UserTrackAnalysisServiceProtocol],
    layout_service: Callable[[], LayoutServiceProtocol],
    song_downloads_enabled: Callable[[], bool],
) -> APIRouter:
    """Create routes for visualization users, layouts, and shares."""
    router = APIRouter()

    @router.post("/users")
    async def create_user(payload: dict[str, Any]) -> dict[str, Any]:
        return create_user_response(payload)

    @router.get("/users/{username}")
    async def get_user_profile(username: str) -> dict[str, Any]:
        return get_user(username)

    @router.post("/users/{username}/tracks")
    async def submit_user_track(username: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await submit_user_track_response(username, payload, user_track_analysis_service(), song_downloads_enabled)

    @router.get("/users/{username}/tracks")
    async def list_user_owned_tracks(username: str) -> list[dict[str, Any]]:
        return list_user_owned_track_responses(username, song_downloads_enabled)

    @router.get("/users/{username}/preferences")
    async def list_user_preferences(username: str) -> dict[str, Any]:
        return list_user_preference_responses(username)

    @router.post("/users/{username}/preferences")
    async def set_user_preference(username: str, payload: PreferenceRequest) -> dict[str, Any]:
        return set_user_preference_response(username, payload)

    @router.get("/users/{username}/tracks/{user_track_id}/audio")
    async def get_user_track_audio(username: str, user_track_id: int) -> FileResponse:
        return get_user_track_audio_response(username, user_track_id, song_downloads_enabled)

    @router.get("/user-track-jobs/{job_id}")
    async def get_user_track_job(job_id: str) -> dict[str, Any]:
        return get_user_track_job_response(job_id, user_track_analysis_service(), song_downloads_enabled)

    @router.get("/visualization")
    async def get_visualization(username: str | None = None) -> dict[str, Any]:
        return get_visualization_response(username, song_downloads_enabled)

    @router.post("/layouts/recompute")
    async def recompute_visualization_layout(payload: LayoutRequest) -> dict[str, Any]:
        return await recompute_visualization_layout_response(payload, layout_service())

    @router.get("/layout-jobs/{job_id}")
    async def get_layout_job(job_id: str) -> dict[str, Any]:
        return get_layout_job_response(job_id, layout_service())

    @router.post("/shares")
    async def create_share(payload: dict[str, Any]) -> dict[str, Any]:
        return create_share_response(payload)

    @router.get("/shares/{token}")
    async def get_share(token: str) -> dict[str, Any]:
        return _get_share(token)

    return router


def require_song_downloads_and_embeddings(song_downloads_enabled: Callable[[], bool]) -> None:
    """Raise a 403 when per-user song downloads and embeddings are disabled."""
    if not song_downloads_enabled():
        raise HTTPException(status_code=403, detail="per-user song downloads and embeddings are disabled")


def create_user_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Create or refresh a public visualization user."""
    return get_or_create_user(str(payload.get("username", "")))


async def submit_user_track_response(
    username: str,
    payload: dict[str, Any],
    service: UserTrackAnalysisServiceProtocol,
    song_downloads_enabled: Callable[[], bool],
) -> dict[str, Any]:
    """Queue download and embedding analysis for a user-submitted track."""
    require_song_downloads_and_embeddings(song_downloads_enabled)
    track = _create_user_track(username, str(payload.get("url", "")))
    job = await service.enqueue(int(track["id"]))
    return {"track": track, "job": job.as_dict()}


def list_user_owned_track_responses(username: str, song_downloads_enabled: Callable[[], bool]) -> list[dict[str, Any]]:
    """List tracks submitted by a visualization user."""
    require_song_downloads_and_embeddings(song_downloads_enabled)
    return list_user_tracks(username)


def list_user_preference_responses(username: str) -> dict[str, Any]:
    """Return current non-cleared preferences for a visualization user."""
    init_db()
    return {"username": username, "preferences": current_preferences(username)}


def set_user_preference_response(username: str, payload: PreferenceRequest) -> dict[str, Any]:
    """Set or clear a visualization preference for a user."""
    init_db()
    return set_preference(username, payload, now)


def get_user_track_audio_response(
    username: str,
    user_track_id: int,
    song_downloads_enabled: Callable[[], bool],
) -> FileResponse:
    """Stream cached audio for a user-submitted track."""
    require_song_downloads_and_embeddings(song_downloads_enabled)
    track = get_user_track_for_username(username, user_track_id)
    path = track.get("path")
    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="cached audio not found")
    return FileResponse(path, media_type="audio/mpeg")


def get_user_track_job_response(
    job_id: str,
    service: UserTrackAnalysisServiceProtocol,
    song_downloads_enabled: Callable[[], bool],
) -> dict[str, Any]:
    """Return one user-track analysis job by ID."""
    require_song_downloads_and_embeddings(song_downloads_enabled)
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="user track job not found")
    return job


def get_visualization_response(username: str | None, song_downloads_enabled: Callable[[], bool]) -> dict[str, Any]:
    """Return visualization points and feature flags for the map UI."""
    user_song_downloads_enabled = song_downloads_enabled()
    if username:
        get_or_create_user(username)
    points = visualization_points(username if user_song_downloads_enabled else None)
    return {
        "username": username,
        "features": {"song_downloads_and_embeddings": user_song_downloads_enabled},
        "points": points,
        "point_count": len(points),
        "base_point_count": sum(1 for point in points if point.get("kind") == "track"),
        "artist_point_count": sum(1 for point in points if point.get("kind") == "artist"),
        "user_point_count": sum(1 for point in points if point.get("kind") == "user_track"),
        "has_cached_layout": latest_layout_points(username) is not None,
    }


async def recompute_visualization_layout_response(payload: LayoutRequest, service: LayoutServiceProtocol) -> dict[str, Any]:
    """Queue recomputation of visualization coordinates and clusters."""
    job = await service.enqueue(payload)
    return job.as_dict()


def get_layout_job_response(job_id: str, service: LayoutServiceProtocol) -> dict[str, Any]:
    """Return one visualization layout job by ID."""
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="layout job not found")
    return job


def create_share_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a share token for visualization preferences and tracks."""
    return _create_share(str(payload.get("username", "")), payload)
