from __future__ import annotations

import asyncio
from uuid import uuid4

from ..embeddings import ClapEmbeddingModel
from ..jobs import BackgroundJobQueue
from ..runtime import now
from ..schemas import ComputeRequest
from ..user_visualization import UserTrackJob, analyze_user_track, load_user_track_job, record_user_track_job, set_user_track_status


class UserTrackAnalysisService(BackgroundJobQueue[UserTrackJob]):
    """Process user-submitted tracks in a background queue."""

    def __init__(self, model_cls: type[ClapEmbeddingModel] = ClapEmbeddingModel):
        super().__init__(worker_name="user-track-analysis-worker")
        self.model_cls = model_cls
        self._model: ClapEmbeddingModel | None = None
        self._lock = asyncio.Lock()

    async def enqueue(self, user_track_id: int) -> UserTrackJob:
        """Queue analysis for a user-submitted track."""
        job = UserTrackJob(id=uuid4().hex, user_track_id=user_track_id)
        record_user_track_job(job)
        return await self._enqueue_job(job)

    def get_job(self, job_id: str) -> dict | None:
        """Return a user-track job from memory or persisted history."""
        job = super().get_job(job_id)
        return job.as_dict() if job else load_user_track_job(job_id)

    async def _process(self, job: UserTrackJob) -> None:
        request = ComputeRequest(only_missing=False)
        job.status = "running"
        job.phase = "analyzing"
        job.started_at = now()
        record_user_track_job(job)
        try:
            async with self._lock:
                if self._model is None:
                    self._model = await asyncio.to_thread(self.model_cls, model_name=request.model_name, device=request.device)
                await asyncio.to_thread(analyze_user_track, job.user_track_id, self._model, request)
            job.status = "completed"
            job.phase = None
            job.finished_at = now()
        except Exception as exc:
            job.status = "failed"
            job.phase = None
            job.error = str(exc)
            job.finished_at = now()
            await asyncio.to_thread(set_user_track_status, job.user_track_id, "failed", error=str(exc))
        record_user_track_job(job)
