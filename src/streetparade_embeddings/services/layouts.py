from __future__ import annotations

import asyncio
from uuid import uuid4

from ..jobs import BackgroundJobQueue
from ..runtime import now
from ..schemas import LayoutRequest
from ..user_visualization import LayoutJob, load_layout_job, recompute_layout, save_layout_job


class LayoutService(BackgroundJobQueue[LayoutJob]):
    """Process visualization layout recomputation jobs in a queue."""

    def __init__(self):
        super().__init__(worker_name="layout-worker")

    async def enqueue(self, request: LayoutRequest) -> LayoutJob:
        """Queue visualization layout recomputation."""
        job = LayoutJob(id=uuid4().hex, username=request.username, request=request)
        save_layout_job(job)
        return await self._enqueue_job(job)

    def get_job(self, job_id: str) -> dict | None:
        """Return a layout job from memory or persisted history."""
        job = super().get_job(job_id)
        return job.as_dict() if job else load_layout_job(job_id)

    async def _process(self, job: LayoutJob) -> None:
        job.status = "running"
        job.started_at = now()
        save_layout_job(job)
        try:
            points = await asyncio.to_thread(recompute_layout, job.username, job.request)
            job.status = "completed"
            job.finished_at = now()
            save_layout_job(job, points=points)
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = now()
            save_layout_job(job)
