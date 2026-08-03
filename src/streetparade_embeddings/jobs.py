from __future__ import annotations

import asyncio
from typing import Generic, TypeVar


JobT = TypeVar("JobT")


class BackgroundJobQueue(Generic[JobT]):
    """Small reusable single-worker queue for API background jobs."""

    def __init__(self, worker_name: str):
        self.worker_name = worker_name
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._jobs: dict[str, JobT] = {}
        self._worker: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the background worker if it is not already running."""
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name=self.worker_name)

    async def stop(self) -> None:
        """Cancel and await the background worker."""
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None

    def get_job(self, job_id: str) -> JobT | None:
        """Return a queued or processed job by ID, if known."""
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[JobT]:
        """Return jobs ordered from newest to oldest."""
        return sorted(self._jobs.values(), key=lambda job: getattr(job, "created_at"), reverse=True)

    def cancel(self, job_id: str, now: str) -> JobT | None:
        """Request cooperative cancellation for a queued or running job.

        Args:
            job_id: Job identifier.
            now: Timestamp to write when a queued job is cancelled immediately.

        Returns:
            Updated job, or ``None`` when no job exists for ``job_id``.
        """
        job = self._jobs.get(job_id)
        if job is None:
            return None
        status = getattr(job, "status", None)
        if status == "queued":
            setattr(job, "status", "cancelled")
            setattr(job, "cancel_requested", True)
            setattr(job, "finished_at", now)
        elif status == "running":
            setattr(job, "status", "cancelling")
            setattr(job, "cancel_requested", True)
        return job

    async def _enqueue_job(self, job: JobT) -> JobT:
        await self.start()
        self._jobs[getattr(job, "id")] = job
        await self._queue.put(getattr(job, "id"))
        return job

    async def _run(self) -> None:
        while True:
            job_id = await self._queue.get()
            job = self._jobs[job_id]
            try:
                if getattr(job, "cancel_requested", False):
                    setattr(job, "status", "cancelled")
                    continue
                await self._process(job)
            finally:
                self._queue.task_done()

    async def _process(self, job: JobT) -> None:
        raise NotImplementedError
