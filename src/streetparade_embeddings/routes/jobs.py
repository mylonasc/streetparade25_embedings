from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

from fastapi import APIRouter, HTTPException

from ..db import connect, init_db
from ..repositories import get_artist, validate_artist_download_request
from ..schemas import ComputeRequest, DownloadRequest


class SerializableJob(Protocol):
    """Protocol for job objects returned by background services."""

    status: str

    def as_dict(self) -> dict[str, Any]:
        """Serialize the job for API responses."""


class DownloadServiceProtocol(Protocol):
    """Protocol for artist download queue services."""

    async def enqueue(self, artist_id: int, request: DownloadRequest) -> SerializableJob: ...
    def get_job(self, job_id: str) -> SerializableJob | None: ...
    def list_jobs(self) -> list[SerializableJob]: ...
    def cancel(self, job_id: str) -> SerializableJob | None: ...


class EmbeddingServiceProtocol(Protocol):
    """Protocol for embedding queue services."""

    async def enqueue(self, request: ComputeRequest) -> SerializableJob: ...
    def get_job(self, job_id: str) -> SerializableJob | None: ...
    def list_jobs(self) -> list[SerializableJob]: ...
    def cancel(self, job_id: str) -> SerializableJob | None: ...


def create_job_router(
    download_service: Callable[[], DownloadServiceProtocol],
    embedding_service: Callable[[], EmbeddingServiceProtocol],
) -> APIRouter:
    """Create routes for download and embedding background jobs."""
    router = APIRouter()

    @router.post("/artists/{artist_id}/download")
    async def download_artist_tracks(artist_id: int, payload: DownloadRequest) -> dict[str, Any]:
        return await queue_artist_download(artist_id, payload, download_service())

    @router.get("/download-jobs")
    async def list_download_jobs() -> list[dict[str, Any]]:
        return list_download_job_responses(download_service())

    @router.get("/download-jobs/{job_id}")
    async def get_download_job(job_id: str) -> dict[str, Any]:
        return get_download_job_response(job_id, download_service())

    @router.post("/download-jobs/{job_id}/cancel")
    async def cancel_download_job(job_id: str) -> dict[str, Any]:
        return cancel_download_job_response(job_id, download_service())

    @router.post("/embeddings/compute")
    async def compute_embeddings(payload: ComputeRequest) -> dict[str, Any]:
        return await queue_embedding_compute(payload, embedding_service())

    @router.post("/artists/{artist_id}/embeddings/compute")
    async def compute_artist_track_embeddings(artist_id: int, payload: ComputeRequest) -> dict[str, Any]:
        request = payload.model_copy(update={"artist_id": artist_id})
        return await queue_embedding_compute(request, embedding_service())

    @router.get("/embedding-jobs")
    async def list_embedding_jobs() -> list[dict[str, Any]]:
        return list_embedding_job_responses(embedding_service())

    @router.get("/embedding-jobs/{job_id}")
    async def get_embedding_job(job_id: str) -> dict[str, Any]:
        return get_embedding_job_response(job_id, embedding_service())

    @router.post("/embedding-jobs/{job_id}/cancel")
    async def cancel_embedding_job(job_id: str) -> dict[str, Any]:
        return cancel_embedding_job_response(job_id, embedding_service())

    return router


async def queue_artist_download(
    artist_id: int,
    payload: DownloadRequest,
    service: DownloadServiceProtocol,
) -> dict[str, Any]:
    """Validate and queue discovery, download, and sampling for an artist."""
    init_db()
    validate_artist_download_request(artist_id, payload)
    job = await service.enqueue(artist_id, payload)
    return job.as_dict()


def list_download_job_responses(service: DownloadServiceProtocol) -> list[dict[str, Any]]:
    """Serialize all download jobs from newest to oldest."""
    return [job.as_dict() for job in service.list_jobs()]


def get_download_job_response(job_id: str, service: DownloadServiceProtocol) -> dict[str, Any]:
    """Serialize one download job by ID."""
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="download job not found")
    return job.as_dict()


def cancel_download_job_response(job_id: str, service: DownloadServiceProtocol) -> dict[str, Any]:
    """Request cancellation for one download job and serialize it."""
    job = service.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="download job not found")
    return job.as_dict()


async def queue_embedding_compute(payload: ComputeRequest, service: EmbeddingServiceProtocol) -> dict[str, Any]:
    """Validate and queue embedding computation for matching tracks."""
    init_db()
    if payload.artist_id is not None:
        with connect() as conn:
            get_artist(conn, payload.artist_id)
    job = await service.enqueue(payload)
    return job.as_dict()


def list_embedding_job_responses(service: EmbeddingServiceProtocol) -> list[dict[str, Any]]:
    """Serialize all embedding jobs from newest to oldest."""
    return [job.as_dict() for job in service.list_jobs()]


def get_embedding_job_response(job_id: str, service: EmbeddingServiceProtocol) -> dict[str, Any]:
    """Serialize one embedding job by ID."""
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="embedding job not found")
    return job.as_dict()


def cancel_embedding_job_response(job_id: str, service: EmbeddingServiceProtocol) -> dict[str, Any]:
    """Request cancellation for one embedding job and serialize it."""
    job = service.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="embedding job not found")
    return job.as_dict()
