from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .config import PipelineConfig
from .embeddings import ClapEmbeddingModel, aggregate_embeddings
from .models import ArtistEmbeddingResult
from .models import MediaDownload
from .models import TrackDownload
from .soundcloud import ArtistData, download_track_to_cache, load_artist_links, save_artist_links
from .soundcloud import DiscoveryMethod
from .youtube import download_youtube_to_cache


def compute_artist_embedding(
    artist: str,
    links: list[str],
    model: ClapEmbeddingModel,
    config: PipelineConfig,
) -> ArtistEmbeddingResult:
    """Compute an artist-level embedding from cached track downloads.

    Args:
        artist: Artist name used for cache lookup and result metadata.
        links: SoundCloud track URLs for the artist.
        model: Loaded embedding model.
        config: Pipeline settings controlling cache paths and chunking.

    Returns:
        Artist embedding result with averaged vector, processed paths, and
        per-track error messages.
    """
    artist_data = ArtistData(artist, links, cache_folder=config.resolved_cache_dir)
    track_embeddings = []
    track_paths = []
    errors = []

    for _, local_path in artist_data:
        if not local_path.exists():
            continue
        try:
            track_embeddings.append(
                model.embed_track(
                    local_path,
                    sampling_rate=config.sampling_rate,
                    chunk_seconds=config.chunk_seconds,
                    stride_seconds=config.chunk_stride_seconds,
                    max_chunks=config.max_chunks,
                )
            )
            track_paths.append(local_path)
            if len(track_embeddings) >= config.max_tracks:
                break
        except Exception as exc:  # Keep long research runs moving while preserving the failure reason.
            errors.append(f"{local_path}: {exc}")

    return ArtistEmbeddingResult(
        artist=artist,
        embedding=aggregate_embeddings(track_embeddings),
        track_paths=track_paths,
        errors=errors,
    )


def compute_artist_embeddings(config: PipelineConfig) -> list[ArtistEmbeddingResult]:
    """Compute embeddings for every artist in the configured links file.

    Args:
        config: Pipeline configuration containing links, model, and audio
            preprocessing settings.

    Returns:
        List of artist embedding results in links-file order.
    """
    artist_links = load_artist_links(config.resolved_links_file)
    model = ClapEmbeddingModel(model_name=config.model_name, device=config.device)
    return [compute_artist_embedding(artist, links, model, config) for artist, links in artist_links.items()]


def save_embedding_results(results: list[ArtistEmbeddingResult], output_dir: str | Path) -> None:
    """Persist artist embedding arrays and metadata files.

    Args:
        results: Artist embedding results to save.
        output_dir: Directory receiving ``artist_embeddings.npz`` and
            ``artist_metadata.json``.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    available = [result for result in results if result.embedding is not None]
    if available:
        embeddings = np.vstack([result.embedding for result in available if result.embedding is not None])
        artists = np.array([result.artist for result in available])
        np.savez_compressed(output_dir / "artist_embeddings.npz", embeddings=embeddings, artists=artists)

    metadata = [
        {
            "artist": result.artist,
            "has_embedding": result.embedding is not None,
            "track_paths": [str(path) for path in result.track_paths],
            "errors": result.errors,
        }
        for result in results
    ]
    with (output_dir / "artist_metadata.json").open("w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)


def download_artist_tracks(config: PipelineConfig, num_links: int | None = None) -> None:
    """Download configured SoundCloud tracks into the cache.

    Args:
        config: Pipeline configuration containing links and cache paths.
        num_links: Optional per-artist link limit overriding ``config.max_tracks``.
    """
    artist_links = load_artist_links(config.resolved_links_file)
    limit = num_links or config.max_tracks
    for artist, links in artist_links.items():
        ArtistData(artist, links, cache_folder=config.resolved_cache_dir).download_links(num_links=limit)


def download_single_track(config: PipelineConfig, track_url: str, artist: str | None = None) -> TrackDownload:
    """Download one SoundCloud track into the pipeline cache.

    Args:
        config: Pipeline configuration containing cache paths.
        track_url: SoundCloud track URL.
        artist: Optional artist bucket; inferred when omitted.

    Returns:
        Download result with cache path and whether a new file was downloaded.
    """
    return download_track_to_cache(track_url, config.resolved_cache_dir, artist=artist)


def download_youtube_track(config: PipelineConfig, video_url: str, artist: str | None = None) -> MediaDownload:
    """Download one YouTube video as MP3 into the pipeline cache.

    Args:
        config: Pipeline configuration containing cache paths.
        video_url: YouTube video URL.
        artist: Optional artist/channel bucket; inferred when omitted.

    Returns:
        Download result with media metadata and cache path.
    """
    return download_youtube_to_cache(video_url, config.resolved_cache_dir, artist=artist)


def write_soundcloud_artist_links(
    config: PipelineConfig,
    discovery_method: DiscoveryMethod | str = DiscoveryMethod.REQUESTS_HTML,
) -> dict[str, list[str]]:
    """Discover SoundCloud tracks from saved Street Parade HTML.

    Args:
        config: Pipeline configuration containing the HTML and links-file paths.
        discovery_method: SoundCloud discovery backend to use.

    Returns:
        Mapping from artist names to discovered SoundCloud track URLs.
    """
    from .soundcloud import discover_track_urls_sync, parse_artists_from_html

    artist_links: dict[str, list[str]] = {}
    for artist in parse_artists_from_html(config.resolved_html_file):
        if artist.soundcloud_url is None:
            continue
        artist_links[artist.name] = discover_track_urls_sync(artist.soundcloud_url, method=discovery_method)
    save_artist_links(artist_links, config.resolved_links_file)
    return artist_links
