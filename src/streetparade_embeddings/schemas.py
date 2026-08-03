from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field as _Field

from .audio import DEFAULT_SAMPLING_RATE
from .config import Device
from .soundcloud import DiscoveryMethod


class ArtistCreate(BaseModel):
    """Request body for creating or updating an artist."""

    name: str = _Field(min_length=1)
    links: list[str] = _Field(default_factory=list)
    images: list[str] = _Field(default_factory=list)
    info: list[str] = _Field(default_factory=list)
    socials: list[dict[str, Any]] = _Field(default_factory=list)
    bio: str | None = None
    soundcloud_url: str | None = None
    instagram: str | None = None
    youtube: str | None = None
    web: str | None = None


class DownloadRequest(BaseModel):
    """Request body for discovering, downloading, and sampling artist tracks."""

    max_tracks: int = _Field(default=5, ge=1)
    track_urls: list[str] | None = None
    discovery_method: DiscoveryMethod = DiscoveryMethod.YT_DLP
    cache_dir: str = ".songs_cache"
    sampling_rate: int = DEFAULT_SAMPLING_RATE
    chunk_seconds: int = _Field(default=30, ge=1)
    chunk_stride_seconds: int = _Field(default=60, ge=1)
    max_chunks: int = _Field(default=10, ge=1)


class ComputeRequest(BaseModel):
    """Request body for queued CLAP embedding computation."""

    artist_id: int | None = None
    only_missing: bool = True
    embedding_backend: str = "clap"
    model_name: str = "laion/clap-htsat-unfused"
    model_revision: str | None = None
    model_options: dict[str, Any] = _Field(default_factory=dict)
    device: Device = Device.AUTO
    sampling_rate: int = DEFAULT_SAMPLING_RATE
    chunk_seconds: int = _Field(default=30, ge=1)
    chunk_stride_seconds: int = _Field(default=60, ge=1)
    max_chunks: int = _Field(default=10, ge=1)
    max_tracks: int | None = _Field(default=None, ge=1)
    compute_segment_embeddings: bool = False


class SimilaritySearchRequest(BaseModel):
    """Request body for track-embedding similarity search."""

    embedding: list[float] | None = None
    vector_ids: list[str] | None = None
    track_ids: list[int] | None = None
    n_results: int = _Field(default=10, ge=1, le=100)
    metric: Literal["cosine", "euclidean"] = "cosine"
    artist_id: int | None = None
    embedding_backend: str | None = None
    embedding_model: str | None = None
    sampling_strategy_hash: str | None = None


TsneMetric = Literal["cosine", "euclidean", "manhattan"]
LayoutInput = Literal["raw", "pca"]


class LayoutRequest(BaseModel):
    """Request body for recomputing visualization coordinates and clusters."""

    username: str | None = None
    pca_enabled: bool = False
    pca_components: int = _Field(default=10, ge=1)
    tsne_input: LayoutInput = "raw"
    cluster_count: int | None = _Field(default=None, ge=1)
    cluster_input: LayoutInput = "raw"
    tsne_perplexity: float | None = _Field(default=None, gt=0)
    tsne_learning_rate: float | Literal["auto"] = "auto"
    tsne_metric: TsneMetric = "cosine"
    random_state: int = 42


PreferenceValue = Literal["up", "down", "clear"]


class PreferenceRequest(BaseModel):
    """Request body for setting a user's visualization preference."""

    point_id: str = _Field(min_length=1)
    target_kind: Literal["track", "user_track", "artist"]
    target_id: str = _Field(min_length=1)
    value: PreferenceValue
    track_id: int | None = None
    user_track_id: int | None = None
    vector_id: str | None = None


@dataclass
class EmbeddingJob:
    """In-memory status record for a queued embedding computation job."""

    id: str
    request: ComputeRequest
    status: str = "queued"
    processed: list[dict[str, Any]] = field(default_factory=list)
    total: int | None = None
    error: str | None = None
    cancel_requested: bool = False
    created_at: str = field(default_factory=lambda: _default_now())
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Serialize the job for API responses.

        Returns:
            JSON-compatible job status dictionary.
        """
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


@dataclass
class DownloadJob:
    """In-memory status record for a queued artist download job."""

    id: str
    artist_id: int
    request: DownloadRequest
    status: str = "queued"
    phase: str | None = None
    processed: list[dict[str, Any]] = field(default_factory=list)
    total: int | None = None
    error: str | None = None
    cancel_requested: bool = False
    created_at: str = field(default_factory=lambda: _default_now())
    started_at: str | None = None
    finished_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Serialize the job for API responses.

        Returns:
            JSON-compatible job status dictionary.
        """
        return {
            "id": self.id,
            "artist_id": self.artist_id,
            "status": self.status,
            "phase": self.phase,
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


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


_default_now: Callable[[], str] = _utc_now


def set_job_clock(clock: Callable[[], str]) -> None:
    """Override the clock used for new job timestamps.

    Args:
        clock: Callable returning an ISO timestamp string.
    """
    global _default_now
    _default_now = clock
