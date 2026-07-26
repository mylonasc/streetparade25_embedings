from __future__ import annotations

import asyncio
import hashlib
import json
from enum import Enum
from pathlib import Path
from urllib.parse import urljoin

from .models import Artist, TrackDownload


class DiscoveryMethod(str, Enum):
    REQUESTS_HTML = "requests-html"
    YT_DLP = "yt-dlp"

    @classmethod
    def from_value(cls, value: "DiscoveryMethod | str") -> "DiscoveryMethod":
        if isinstance(value, cls):
            return value
        try:
            return cls(value)
        except ValueError as exc:
            allowed = ", ".join(method.value for method in cls)
            raise ValueError(f"discovery method must be one of: {allowed}") from exc


def stable_hash(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()


def artist_cache_dir(cache_dir: str | Path, artist: str) -> Path:
    return Path(cache_dir) / stable_hash(artist)


def track_cache_path(cache_dir: str | Path, artist: str, track_url: str) -> Path:
    return artist_cache_dir(cache_dir, artist) / f"{stable_hash(track_url)}.mp3"


def parse_artists_from_html(html_file: str | Path) -> list[Artist]:
    """Parse Street Parade artist data from a saved HTML file."""

    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:
        raise RuntimeError("HTML parsing requires beautifulsoup4") from exc

    with Path(html_file).open("r", encoding="utf-8") as handle:
        soup = BeautifulSoup(handle, "html.parser")

    artists: list[Artist] = []
    for item in soup.select("li.artist-list-item"):
        name_tag = item.select_one("h3.h2")
        if not name_tag:
            continue
        links = [anchor["href"] for anchor in item.select("a[href]")]
        images = [image["src"] for image in item.select("img[src]")]
        soundcloud_url = next((link for link in links if "soundcloud" in link.lower()), None)
        artists.append(
            Artist(
                name=name_tag.get_text(strip=True),
                links=links,
                images=images,
                soundcloud_url=soundcloud_url,
            )
        )
    return artists


class SoundCloudTrackDiscoverer:
    """Discover SoundCloud track URLs using a selectable backend."""

    def __init__(
        self,
        method: DiscoveryMethod | str = DiscoveryMethod.REQUESTS_HTML,
        sleep_seconds: int = 15,
        timeout: int = 40,
    ):
        self.method = DiscoveryMethod.from_value(method)
        self.sleep_seconds = sleep_seconds
        self.timeout = timeout

    def discover(self, soundcloud_url: str) -> list[str]:
        if self.method is DiscoveryMethod.YT_DLP:
            return discover_track_urls_ytdlp(soundcloud_url)
        return asyncio.run(
            discover_track_urls_requests_html(
                soundcloud_url,
                sleep_seconds=self.sleep_seconds,
                timeout=self.timeout,
            )
        )

    async def discover_async(self, soundcloud_url: str) -> list[str]:
        if self.method is DiscoveryMethod.YT_DLP:
            return discover_track_urls_ytdlp(soundcloud_url)
        return await discover_track_urls_requests_html(
            soundcloud_url,
            sleep_seconds=self.sleep_seconds,
            timeout=self.timeout,
        )


async def discover_track_urls_requests_html(
    soundcloud_url: str,
    sleep_seconds: int = 15,
    timeout: int = 40,
) -> list[str]:
    """Render a SoundCloud tracks page with requests-html and return discovered track URLs."""

    try:
        from requests_html import AsyncHTMLSession
    except ImportError as exc:
        raise RuntimeError("Track discovery requires requests-html") from exc

    page_url = soundcloud_url.rstrip("/") + "/tracks"
    session = AsyncHTMLSession()
    try:
        response = await session.get(page_url)
        await response.html.arender(sleep=sleep_seconds, timeout=timeout, scrolldown=1)
        await asyncio.sleep(1)
        return [urljoin(page_url, anchor.attrs["href"]) for anchor in response.html.find("a.sound__coverArt[href]")]
    finally:
        await session.close()


async def discover_track_urls(soundcloud_url: str, sleep_seconds: int = 15, timeout: int = 40) -> list[str]:
    """Compatibility wrapper for requests-html SoundCloud track discovery."""

    return await discover_track_urls_requests_html(soundcloud_url, sleep_seconds=sleep_seconds, timeout=timeout)


def discover_track_urls_ytdlp(soundcloud_url: str) -> list[str]:
    """Use yt-dlp flat extraction to discover tracks for a SoundCloud URL."""

    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("yt-dlp SoundCloud discovery requires yt-dlp") from exc

    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "noplaylist": False,
        "skip_download": True,
        "cachedir": False,
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(soundcloud_url, download=False)

    entries = info.get("entries") or []
    urls = [_entry_track_url(entry) for entry in entries if entry]
    return [url for url in urls if url]


def discover_track_urls_sync(
    soundcloud_url: str,
    sleep_seconds: int = 15,
    timeout: int = 40,
    method: DiscoveryMethod | str = DiscoveryMethod.REQUESTS_HTML,
) -> list[str]:
    discoverer = SoundCloudTrackDiscoverer(method=method, sleep_seconds=sleep_seconds, timeout=timeout)
    return discoverer.discover(soundcloud_url)


def _entry_track_url(entry: dict) -> str | None:
    url = entry.get("webpage_url") or entry.get("url")
    if isinstance(url, str) and url.startswith("http"):
        return url
    return None


def load_artist_links(path: str | Path) -> dict[str, list[str]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_artist_links(artist_links: dict[str, list[str]], path: str | Path) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(artist_links, handle, ensure_ascii=False, indent=2)


def download_track(track_url: str, output_path: str | Path) -> TrackDownload:
    """Download one SoundCloud track to output_path."""

    try:
        from sclib import SoundcloudAPI, Track
    except ImportError as exc:
        raise RuntimeError("Downloading requires soundcloud-lib") from exc

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        return TrackDownload(artist="", url=track_url, path=output_path, downloaded=False)

    try:
        api = SoundcloudAPI()
        track = api.resolve(track_url)
        if not isinstance(track, Track):
            raise TypeError(f"Expected a SoundCloud track for {track_url}, got {type(track).__name__}")

        with output_path.open("wb+") as handle:
            track.write_mp3_to(handle)
        return TrackDownload(artist=getattr(track, "artist", ""), url=track_url, path=output_path, downloaded=True)
    except Exception:
        return _download_with_ytdlp(track_url, output_path, artist=None)


def download_track_to_cache(track_url: str, cache_dir: str | Path, artist: str | None = None) -> TrackDownload:
    """Download a SoundCloud track into the artist cache, inferring artist when needed."""

    try:
        return _download_to_cache_with_ytdlp(track_url, cache_dir, artist=artist)
    except Exception:
        pass

    try:
        from sclib import SoundcloudAPI, Track

        api = SoundcloudAPI()
        track = api.resolve(track_url)
        if not isinstance(track, Track):
            raise TypeError(f"Expected a SoundCloud track for {track_url}, got {type(track).__name__}")

        inferred_artist = artist or getattr(track, "artist", None) or "direct-track"
        output_path = track_cache_path(cache_dir, inferred_artist, track_url)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists():
            return TrackDownload(artist=inferred_artist, url=track_url, path=output_path, downloaded=False)

        with output_path.open("wb+") as handle:
            track.write_mp3_to(handle)
        return TrackDownload(artist=inferred_artist, url=track_url, path=output_path, downloaded=True)
    except Exception:
        return _download_to_cache_with_ytdlp(track_url, cache_dir, artist=artist)


def _download_to_cache_with_ytdlp(track_url: str, cache_dir: str | Path, artist: str | None = None) -> TrackDownload:
    info = _extract_ytdlp_info(track_url)
    inferred_artist = artist or _artist_from_ytdlp_info(info) or "direct-track"
    output_path = track_cache_path(cache_dir, inferred_artist, track_url)
    if output_path.exists():
        return TrackDownload(artist=inferred_artist, url=track_url, path=output_path, downloaded=False)
    return _download_with_ytdlp(track_url, output_path, artist=inferred_artist)


def _extract_ytdlp_info(track_url: str) -> dict:
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("Downloading requires soundcloud-lib or yt-dlp") from exc

    with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
        return ydl.extract_info(track_url, download=False)


def _artist_from_ytdlp_info(info: dict) -> str | None:
    return info.get("artist") or info.get("creator") or info.get("uploader") or info.get("channel")


def _download_with_ytdlp(track_url: str, output_path: str | Path, artist: str | None) -> TrackDownload:
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("Downloading requires soundcloud-lib or yt-dlp") from exc

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        return TrackDownload(artist=artist or "", url=track_url, path=output_path, downloaded=False)

    ydl_opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "outtmpl": str(output_path.with_suffix(".%(ext)s")),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
    }
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(track_url, download=True)
    return TrackDownload(artist=artist or _artist_from_ytdlp_info(info) or "", url=track_url, path=output_path, downloaded=True)


class ArtistData:
    """Cache-aware view over an artist's SoundCloud track URLs."""

    def __init__(self, artist: str, links: list[str], cache_folder: str | Path = ".songs_cache"):
        self.artist = artist
        self.links = links
        self.cache_folder = Path(cache_folder)
        self.artist_storage_dir = artist_cache_dir(self.cache_folder, artist)
        self.artist_storage_dir.mkdir(parents=True, exist_ok=True)

    def download_links(self, num_links: int = 2) -> list[TrackDownload]:
        results = []
        for track_url in self.links[:num_links]:
            path = self.get_track_path_by_url(track_url)
            result = download_track(track_url, path)
            results.append(TrackDownload(self.artist, track_url, path, result.downloaded))
        return results

    def donwload_links(self, num_links: int = 2) -> list[TrackDownload]:
        """Backward-compatible alias for the original misspelled method."""

        return self.download_links(num_links=num_links)

    def has_mp3(self) -> bool:
        return bool(self.links) and self.get_track_path(0).exists()

    def get_track_path_by_url(self, track_url: str) -> Path:
        return track_cache_path(self.cache_folder, self.artist, track_url)

    def get_track_path(self, idx: int) -> Path:
        return self.get_track_path_by_url(self.links[idx])

    def __len__(self) -> int:
        return len(self.links)

    def __iter__(self):
        for link in self.links:
            yield link, self.get_track_path_by_url(link)
