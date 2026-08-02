from __future__ import annotations

import hashlib
import json
from typing import Any

from .schemas import ComputeRequest, DownloadRequest


def canonical_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def config_hash(data: Any) -> str:
    return hashlib.sha256(canonical_json(data).encode("utf-8")).hexdigest()


def sampling_strategy(payload: ComputeRequest | DownloadRequest) -> dict[str, Any]:
    return {
        "sampling_rate": payload.sampling_rate,
        "channels": 1,
        "chunk_seconds": payload.chunk_seconds,
        "chunk_stride_seconds": payload.chunk_stride_seconds,
        "max_chunks": payload.max_chunks,
        "normalize": "int16_to_float32",
    }


def embedding_model_config(payload: ComputeRequest) -> dict[str, Any]:
    return {
        "backend": payload.embedding_backend,
        "model_name": payload.model_name,
        "model_revision": payload.model_revision,
        "device": payload.device.value,
        "options": payload.model_options,
    }


def pipeline_config(payload: ComputeRequest) -> dict[str, Any]:
    return {
        "embedding_model": embedding_model_config(payload),
        "sampling_strategy": sampling_strategy(payload),
        "only_missing": payload.only_missing,
        "artist_id": payload.artist_id,
        "max_tracks": payload.max_tracks,
        "compute_segment_embeddings": payload.compute_segment_embeddings,
    }
