from __future__ import annotations

import argparse
from pathlib import Path

from .models import MediaDownload, MediaSource
from .soundcloud import stable_hash


def youtube_cache_path(cache_dir: str | Path, artist: str, video_url: str) -> Path:
    return Path(cache_dir) / "youtube" / stable_hash(artist) / f"{stable_hash(video_url)}.mp3"


def download_youtube_to_cache(video_url: str, cache_dir: str | Path, artist: str | None = None) -> MediaDownload:
    """Download a YouTube video as MP3, inferring artist/channel metadata when needed."""

    info = _extract_ytdlp_info(video_url)
    inferred_artist = artist or _artist_from_ytdlp_info(info) or "youtube"
    title = info.get("title") or ""
    output_path = youtube_cache_path(cache_dir, inferred_artist, video_url)
    if output_path.exists():
        return MediaDownload(MediaSource.YOUTUBE, inferred_artist, title, video_url, output_path, downloaded=False)

    _download_with_ytdlp(video_url, output_path)
    return MediaDownload(MediaSource.YOUTUBE, inferred_artist, title, video_url, output_path, downloaded=True)


def _extract_ytdlp_info(video_url: str) -> dict:
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("YouTube downloads require yt-dlp") from exc

    with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
        return ydl.extract_info(video_url, download=False)


def _artist_from_ytdlp_info(info: dict) -> str | None:
    return info.get("artist") or info.get("creator") or info.get("uploader") or info.get("channel")


def _download_with_ytdlp(video_url: str, output_path: str | Path) -> None:
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("YouTube downloads require yt-dlp") from exc

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
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
        ydl.extract_info(video_url, download=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download a YouTube video as a cached MP3")
    parser.add_argument("url", help="YouTube video URL")
    parser.add_argument("--cache-dir", default=".songs_cache", help="Cache directory for downloaded MP3 files")
    parser.add_argument("--artist", help="Optional cache bucket name; defaults to inferred metadata")
    args = parser.parse_args(argv)

    result = download_youtube_to_cache(args.url, args.cache_dir, artist=args.artist)
    status = "downloaded" if result.downloaded else "already cached"
    print(f"{status}: {result.path}")
    print(f"artist: {result.artist}")
    print(f"title: {result.title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
