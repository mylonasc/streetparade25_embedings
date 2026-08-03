from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from ..jobs import BackgroundJobQueue
from ..repositories import complete_track_download, fail_track_download, get_artist_dict, prepare_track_download
from ..responses import track_response
from ..runtime import now
from ..schemas import DownloadJob, DownloadRequest
from ..soundcloud import DiscoveryMethod, discover_track_urls_requests_html, discover_track_urls_sync, download_track
from ..models import TrackDownload


DownloadTrackFunc = Callable[[str, str | Path], TrackDownload]


class DownloadService(BackgroundJobQueue[DownloadJob]):
    """Process SoundCloud downloads in a background queue."""

    def __init__(self, download_track_func: DownloadTrackFunc = download_track):
        super().__init__(worker_name="download-worker")
        self.download_track = download_track_func

    async def enqueue(self, artist_id: int, request: DownloadRequest) -> DownloadJob:
        """Queue track discovery and download work for an artist."""
        job = DownloadJob(id=uuid4().hex, artist_id=artist_id, request=request)
        return await self._enqueue_job(job)

    def cancel(self, job_id: str) -> DownloadJob | None:
        """Request cancellation for a queued or running download job."""
        return super().cancel(job_id, now())

    async def _process(self, job: DownloadJob) -> None:
        job.status = "running"
        job.started_at = now()
        failures = 0
        try:
            artist = await asyncio.to_thread(get_artist_dict, job.artist_id)
            job.phase = "discovering"
            if job.request.track_urls is None:
                soundcloud_url = artist.get("soundcloud_url")
                if not soundcloud_url:
                    raise RuntimeError("artist has no soundcloud_url and no track_urls were supplied")
                track_urls = await discover_artist_track_urls(soundcloud_url, job.request.discovery_method)
            else:
                track_urls = job.request.track_urls

            track_urls = track_urls[: job.request.max_tracks]
            job.total = len(track_urls)
            job.phase = "downloading"

            for track_url in track_urls:
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = now()
                    return

                prepared = await asyncio.to_thread(
                    prepare_track_download,
                    job.artist_id,
                    artist["name"],
                    track_url,
                    job.request.cache_dir,
                    now,
                )
                try:
                    download = await asyncio.to_thread(self.download_track, track_url, Path(prepared["path"]))
                    if not Path(download.path).exists():
                        raise FileNotFoundError(f"download completed but file is missing: {download.path}")
                    updated = await asyncio.to_thread(complete_track_download, prepared["id"], download.path, job.request, now)
                except Exception as exc:
                    failures += 1
                    updated = await asyncio.to_thread(fail_track_download, prepared["id"], prepared["path"], str(exc), now)
                job.processed.append(track_response(updated))
                if job.cancel_requested:
                    job.status = "cancelled"
                    job.finished_at = now()
                    return

            if failures == 0:
                job.status = "completed"
            elif failures == len(track_urls):
                job.status = "failed"
                job.error = "all track downloads failed"
            else:
                job.status = "completed_with_errors"
                job.error = f"{failures} track downloads failed"
            job.finished_at = now()
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = now()
        finally:
            job.phase = None


async def discover_artist_track_urls(soundcloud_url: str, method: DiscoveryMethod) -> list[str]:
    """Discover track URLs, falling back from requests-html to yt-dlp."""
    if method is DiscoveryMethod.REQUESTS_HTML:
        try:
            return await discover_track_urls_requests_html(soundcloud_url)
        except Exception:
            return await asyncio.to_thread(discover_track_urls_sync, soundcloud_url, method=DiscoveryMethod.YT_DLP)
    return await asyncio.to_thread(discover_track_urls_sync, soundcloud_url, method=method)
