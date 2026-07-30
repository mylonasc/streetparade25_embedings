from __future__ import annotations

import argparse
import re
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin

import requests
import yaml
from bs4 import BeautifulSoup

from streetparade_embeddings.config import Device
from streetparade_embeddings.db import connect, init_db
from streetparade_embeddings.embeddings import ClapEmbeddingModel
from streetparade_embeddings.repositories import (
    complete_track_download,
    create_or_update_artist,
    fail_track_download,
    select_embedding_rows,
    store_track_embedding,
    store_track_error,
    upsert_track,
)
from streetparade_embeddings.schemas import ArtistCreate, ComputeRequest, DownloadRequest
from streetparade_embeddings.soundcloud import ArtistData


DEFAULT_ARTISTS_FILE = Path("artists_2026.yaml")
DEFAULT_CACHE_DIR = Path(".songs_cache")
SOUNDCLOUD_HOME = "https://soundcloud.com"
SOUNDCLOUD_RESOLVE_URL = "https://api-v2.soundcloud.com/resolve"
SOUNDCLOUD_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Origin": SOUNDCLOUD_HOME,
    "Referer": f"{SOUNDCLOUD_HOME}/",
    "User-Agent": "Mozilla/5.0",
}


def now() -> str:
    return datetime.now(UTC).isoformat()


def load_artists(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, list):
        raise ValueError(f"expected a list of artists in {path}")
    return [artist for artist in data if isinstance(artist, dict)]


def social_url(artist: dict[str, Any], platform: str) -> str | None:
    for social in artist.get("socials") or []:
        if not isinstance(social, dict):
            continue
        if str(social.get("platform", "")).lower() == platform:
            url = social.get("url")
            return str(url) if url else None
    return None


def soundcloud_url(artist: dict[str, Any]) -> str | None:
    direct = social_url(artist, "soundcloud")
    if direct:
        return direct
    for social in artist.get("socials") or []:
        if not isinstance(social, dict):
            continue
        url = str(social.get("url") or "")
        if "soundcloud.com" in url.lower():
            return url
    return None


def artist_payload(artist: dict[str, Any]) -> ArtistCreate:
    socials = [social for social in artist.get("socials") or [] if isinstance(social, dict)]
    links = [str(social["url"]) for social in socials if social.get("url")]
    image = artist.get("image")
    return ArtistCreate(
        name=str(artist["name"]),
        links=links,
        images=[str(image)] if image else [],
        info=[str(item) for item in artist.get("info") or []],
        socials=socials,
        bio=artist.get("bio"),
        soundcloud_url=soundcloud_url(artist),
        instagram=social_url(artist, "instagram"),
        youtube=social_url(artist, "youtube"),
        web=social_url(artist, "website"),
    )


def download_soundcloud_track_http_only(track_url: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        return

    client_id = soundcloud_client_id()
    track = resolve_soundcloud_url(track_url, client_id)
    if track.get("kind") != "track":
        raise TypeError(f"Expected a SoundCloud track for {track_url}, got {track.get('kind')}")

    stream_url = progressive_stream_url(track, client_id)
    with requests.get(stream_url, headers=SOUNDCLOUD_HEADERS, stream=True, timeout=60) as response:
        response.raise_for_status()
        with output_path.open("wb+") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)


def discover_soundcloud_tracks_http_only(soundcloud_url: str) -> list[str]:
    client_id = soundcloud_client_id()
    resolved = resolve_soundcloud_url(soundcloud_url, client_id)
    if resolved.get("kind") == "track":
        return [resolved["permalink_url"]]
    if resolved.get("kind") in {"playlist", "system-playlist"}:
        return [track["permalink_url"] for track in resolved.get("tracks") or [] if track.get("permalink_url")]
    if resolved.get("kind") != "user":
        raise TypeError(f"Expected a SoundCloud user, playlist, or track for {soundcloud_url}, got {resolved.get('kind')}")

    track_urls = []
    next_url = f"https://api-v2.soundcloud.com/users/{resolved['id']}/tracks"
    params: dict[str, Any] | None = {"client_id": client_id, "limit": 200, "linked_partitioning": 1}
    while next_url:
        response = requests.get(next_url, params=params, headers=SOUNDCLOUD_HEADERS, timeout=30)
        response.raise_for_status()
        page = response.json()
        tracks = page.get("collection") if isinstance(page, dict) else page
        for track in tracks or []:
            url = track.get("permalink_url")
            if url:
                track_urls.append(url)
        next_url = page.get("next_href") if isinstance(page, dict) else None
        params = {"client_id": client_id} if next_url else None
    return track_urls


@cache
def soundcloud_client_id() -> str:
    response = requests.get(SOUNDCLOUD_HOME, headers=SOUNDCLOUD_HEADERS, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    script_urls = [urljoin(SOUNDCLOUD_HOME, script["src"]) for script in soup.find_all("script", src=True)]
    patterns = (
        r"client_id[=:]\"([a-zA-Z0-9]{20,})\"",
        r"client_id=([a-zA-Z0-9]{20,})",
        r"clientId:\"([a-zA-Z0-9]{20,})\"",
    )
    for script_url in reversed(script_urls):
        script = requests.get(script_url, headers=SOUNDCLOUD_HEADERS, timeout=30)
        if not script.ok:
            continue
        for pattern in patterns:
            match = re.search(pattern, script.text)
            if match:
                return match.group(1)
    raise RuntimeError("could not extract SoundCloud client_id")


def resolve_soundcloud_url(soundcloud_url: str, client_id: str) -> dict[str, Any]:
    response = requests.get(
        SOUNDCLOUD_RESOLVE_URL,
        params={"url": soundcloud_url, "client_id": client_id},
        headers=SOUNDCLOUD_HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    resolved = response.json()
    if not isinstance(resolved, dict):
        raise TypeError(f"unexpected SoundCloud resolve response for {soundcloud_url}")
    return resolved


def progressive_stream_url(track: dict[str, Any], client_id: str) -> str:
    transcodings = ((track.get("media") or {}).get("transcodings") or [])
    for transcoding in transcodings:
        if transcoding.get("format", {}).get("protocol") != "progressive":
            continue
        url = transcoding.get("url")
        if not url:
            continue
        response = requests.get(url, params={"client_id": client_id}, headers=SOUNDCLOUD_HEADERS, timeout=30)
        response.raise_for_status()
        stream_url = response.json().get("url")
        if stream_url:
            return stream_url
    raise RuntimeError(f"no progressive stream available for {track.get('permalink_url')}")


def store_embedding_for_track(track_id: int, artist_id: int, model: ClapEmbeddingModel, request: ComputeRequest) -> bool:
    rows = [row for row in select_embedding_rows(request) if int(row["id"]) == track_id]
    if not rows:
        return False

    try:
        embedding = model.embed_track(
            rows[0]["path"],
            sampling_rate=request.sampling_rate,
            chunk_seconds=request.chunk_seconds,
            stride_seconds=request.chunk_stride_seconds,
            max_chunks=request.max_chunks,
        )
        store_track_embedding(rows[0], embedding, request, now)
        return True
    except Exception as exc:
        store_track_error(track_id, str(exc), now)
        print(f"  embedding failed for track_id={track_id}: {exc}")
        return False


def index_artist(
    raw_artist: dict[str, Any],
    get_model: Callable[[], ClapEmbeddingModel],
    cache_dir: Path,
    max_tracks_per_artist: int | None,
    compute_request_options: dict[str, Any],
) -> tuple[int, int]:
    payload = artist_payload(raw_artist)
    artist = create_or_update_artist(payload, now)
    if not artist.get("soundcloud_url"):
        print(f"{artist['name']}: no SoundCloud URL, skipping")
        return 0, 0

    print(f"{artist['name']}: discovering tracks via soundcloud-lib HTTP API")
    try:
        track_urls = discover_soundcloud_tracks_http_only(artist["soundcloud_url"])
    except Exception as exc:
        print(f"{artist['name']}: discovery failed: {exc}")
        return 0, 0

    if max_tracks_per_artist is not None:
        track_urls = track_urls[:max_tracks_per_artist]
    print(f"{artist['name']}: {len(track_urls)} tracks")

    download_request = DownloadRequest(
        max_tracks=max(1, len(track_urls)),
        track_urls=track_urls,
        cache_dir=str(cache_dir),
        sampling_rate=compute_request_options["sampling_rate"],
        chunk_seconds=compute_request_options["chunk_seconds"],
        chunk_stride_seconds=compute_request_options["chunk_stride_seconds"],
        max_chunks=compute_request_options["max_chunks"],
    )
    compute_request = ComputeRequest(artist_id=artist["id"], **compute_request_options)

    downloaded = 0
    embedded = 0
    artist_data = ArtistData(artist["name"], track_urls, cache_folder=cache_dir)
    for track_url in track_urls:
        path = artist_data.get_track_path_by_url(track_url)
        with connect() as conn:
            track_id = upsert_track(
                conn,
                artist["id"],
                track_url,
                str(path),
                downloaded=path.exists(),
                download_status="completed" if path.exists() else "downloading",
                now=now,
            )

        try:
            download_soundcloud_track_http_only(track_url, path)
            complete_track_download(track_id, path, download_request, now)
            downloaded += 1
        except Exception as exc:
            fail_track_download(track_id, path, str(exc), now)
            print(f"  download failed: {track_url}: {exc}")
            continue

        if store_embedding_for_track(track_id, artist["id"], get_model(), compute_request):
            embedded += 1

    return downloaded, embedded


def main_for_args(args: argparse.Namespace) -> None:
    init_db()
    artists = load_artists(args.artists_file)
    artist_index_start,artist_index_end = 0, len(artists)
    
    if args.artist_index_start is not None:
        artist_index_start = args.artist_index_start

    if args.artist_index_end is not None:
        artist_index_end = args.artist_index_end

    if args.limit_artists is not None:
        if args.artist_index_end is not None:
            raise Exception("cannot set both artist-index-end and limit-artists flag!")
        artist_limit_end = artist_index_start + args.limit_artists
    artists = artists[artist_index_start:artist_index_end]


    max_tracks_per_artist = None if args.max_tracks_per_artist == 0 else args.max_tracks_per_artist
    compute_request_options = {
        "only_missing": not args.recompute,
        "embedding_backend": "clap",
        "model_name": args.model_name,
        "model_revision": None,
        "model_options": {},
        "device": Device.from_value(args.device),
        "sampling_rate": args.sampling_rate,
        "chunk_seconds": args.chunk_seconds,
        "chunk_stride_seconds": args.chunk_stride_seconds,
        "max_chunks": args.max_chunks,
        "max_tracks": None,
    }
    model: ClapEmbeddingModel | None = None

    def get_model() -> ClapEmbeddingModel:
        nonlocal model
        if model is None:
            model = ClapEmbeddingModel(model_name=args.model_name, device=args.device)
        return model

    total_downloaded = 0
    total_embedded = 0
    for raw_artist in artists:
        downloaded, embedded = index_artist(
            raw_artist,
            get_model,
            args.cache_dir,
            max_tracks_per_artist,
            compute_request_options,
        )
        total_downloaded += downloaded
        total_embedded += embedded

    print(f"done: downloaded={total_downloaded}, embedded={total_embedded}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Index SoundCloud tracks for artists_2026 without using yt-dlp.")
    parser.add_argument("--artists-file", type=Path, default=DEFAULT_ARTISTS_FILE)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--artist-index-start", type=int, default=None)
    parser.add_argument("--artist-index-end", type=int, default=None)
    parser.add_argument("--limit-artists", type=int, default=None)
    parser.add_argument("--max-tracks-per-artist", type=int, default=5, help="Use 0 for all discovered tracks.")
    parser.add_argument("--device", default=Device.AUTO.value, choices=[device.value for device in Device])
    parser.add_argument("--model-name", default="laion/clap-htsat-unfused")
    parser.add_argument("--sampling-rate", type=int, default=48_000)
    parser.add_argument("--chunk-seconds", type=int, default=30)
    parser.add_argument("--chunk-stride-seconds", type=int, default=60)
    parser.add_argument("--max-chunks", type=int, default=10)
    parser.add_argument("--recompute", action="store_true", help="Recompute embeddings even if matching metadata already exists.")
    return parser.parse_args()


def main() -> None:
    main_for_args(parse_args())


if __name__ == "__main__":
    main()
