from __future__ import annotations

import asyncio
from uuid import uuid4

from ..config import Device
from ..embeddings import ClapEmbeddingModel
from ..jobs import BackgroundJobQueue
from ..provenance import config_hash
from ..repositories import select_embedding_rows, store_sample_embeddings, store_track_embedding, store_track_error
from ..responses import track_response
from ..runtime import now
from ..schemas import ComputeRequest, EmbeddingJob


class LazyClapEmbeddingService(BackgroundJobQueue[EmbeddingJob]):
    """Owns one lazily-loaded CLAP model and an async embedding job queue."""

    def __init__(self, model_cls: type[ClapEmbeddingModel] = ClapEmbeddingModel):
        super().__init__(worker_name="embedding-worker")
        self.model_cls = model_cls
        self._model: ClapEmbeddingModel | None = None
        self._model_key: tuple[str, str, str | None, Device, str] | None = None
        self._lock = asyncio.Lock()

    async def enqueue(self, request: ComputeRequest) -> EmbeddingJob:
        """Queue an embedding computation request."""
        job = EmbeddingJob(id=uuid4().hex, request=request)
        return await self._enqueue_job(job)

    def cancel(self, job_id: str) -> EmbeddingJob | None:
        """Request cancellation for a queued or running embedding job."""
        return super().cancel(job_id, now())

    async def _process(self, job: EmbeddingJob) -> None:
        job.status = "running"
        job.started_at = now()
        try:
            rows = await asyncio.to_thread(select_embedding_rows, job.request)
            job.total = len(rows)
            if not rows:
                job.status = "completed"
                job.finished_at = now()
                return

            for row in rows:
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = now()
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
                        job.finished_at = now()
                        return
                    updated = await asyncio.to_thread(store_track_embedding, row, embedding, job.request, now)
                    if segment_embeddings is not None:
                        await asyncio.to_thread(store_sample_embeddings, row, segment_embeddings, job.request, now)
                except Exception as exc:
                    updated = await asyncio.to_thread(store_track_error, row["id"], str(exc), now)
                job.processed.append(track_response(updated))

            job.status = "completed"
            job.finished_at = now()
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = now()

    async def _get_model(self, request: ComputeRequest) -> ClapEmbeddingModel:
        if request.embedding_backend != "clap":
            raise ValueError(f"unsupported embedding backend: {request.embedding_backend}")
        key = (
            request.embedding_backend,
            request.model_name,
            request.model_revision,
            request.device,
            config_hash(request.model_options),
        )
        if self._model is None or self._model_key != key:
            self._model = await asyncio.to_thread(self.model_cls, model_name=request.model_name, device=request.device)
            self._model_key = key
        return self._model
