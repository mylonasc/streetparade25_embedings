from __future__ import annotations

import hashlib
import json
from typing import Any

from .schemas import ComputeRequest, DownloadRequest


def canonical_json(data: Any) -> str:
    """Serialize data in a deterministic JSON representation.

    Args:
        data: JSON-serializable value to encode.

    Returns:
        Compact JSON with sorted object keys.
    """
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def config_hash(data: Any) -> str:
    """Hash configuration data using deterministic JSON encoding.

    Args:
        data: JSON-serializable configuration payload.

    Returns:
        Hex-encoded SHA-256 digest.
    """
    return hashlib.sha256(canonical_json(data).encode("utf-8")).hexdigest()


def sampling_strategy(payload: ComputeRequest | DownloadRequest) -> dict[str, Any]:
    """Build provenance metadata for audio sampling and chunking.

    Args:
        payload: Download or embedding request containing audio preprocessing
            settings.

    Returns:
        Dictionary suitable for storage with embedding metadata.
    """
    return {
        "sampling_rate": payload.sampling_rate,
        "channels": 1,
        "chunk_seconds": payload.chunk_seconds,
        "chunk_stride_seconds": payload.chunk_stride_seconds,
        "max_chunks": payload.max_chunks,
        "normalize": "int16_to_float32",
    }


def embedding_model_config(payload: ComputeRequest) -> dict[str, Any]:
    """Build provenance metadata for the embedding model configuration.

    Args:
        payload: Embedding request containing model settings.

    Returns:
        Dictionary describing backend, model identity, device, and options.
    """
    return {
        "backend": payload.embedding_backend,
        "model_name": payload.model_name,
        "model_revision": payload.model_revision,
        "device": payload.device.value,
        "options": payload.model_options,
    }


def pipeline_config(payload: ComputeRequest) -> dict[str, Any]:
    """Build reproducibility metadata for an embedding job.

    Args:
        payload: Embedding request to summarize.

    Returns:
        Dictionary combining model, sampling, filtering, and segment settings.
    """
    return {
        "embedding_model": embedding_model_config(payload),
        "sampling_strategy": sampling_strategy(payload),
        "only_missing": payload.only_missing,
        "artist_id": payload.artist_id,
        "max_tracks": payload.max_tracks,
        "compute_segment_embeddings": payload.compute_segment_embeddings,
    }
