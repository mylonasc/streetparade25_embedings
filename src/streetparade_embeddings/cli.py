from __future__ import annotations

import argparse
from pathlib import Path

from .config import PipelineConfig
from .pipeline import (
    compute_artist_embeddings,
    download_artist_tracks,
    download_single_track,
    save_embedding_results,
    write_soundcloud_artist_links,
)
from .soundcloud import parse_artists_from_html, save_artist_links


def build_config(args: argparse.Namespace) -> PipelineConfig:
    return PipelineConfig(
        data_dir=Path(args.data_dir),
        cache_dir=Path(args.cache_dir) if args.cache_dir else None,
        links_file=Path(args.links_file),
        html_file=Path(args.html_file),
        output_dir=Path(args.output_dir),
        model_name=args.model_name,
        device=args.device,
        sampling_rate=args.sampling_rate,
        chunk_seconds=args.chunk_seconds,
        chunk_stride_seconds=args.chunk_stride_seconds,
        max_chunks=args.max_chunks,
        max_tracks=args.max_tracks,
    )


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-dir", default=".")
    parser.add_argument("--cache-dir")
    parser.add_argument("--links-file", default="artist_links.json")
    parser.add_argument("--html-file", default="streetparade_data.html")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--model-name", default="laion/clap-htsat-unfused")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--sampling-rate", type=int, default=48_000)
    parser.add_argument("--chunk-seconds", type=int, default=30)
    parser.add_argument("--chunk-stride-seconds", type=int, default=60)
    parser.add_argument("--max-chunks", type=int, default=10)
    parser.add_argument("--max-tracks", type=int, default=3)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Street Parade SoundCloud embedding pipeline")
    add_common_args(parser)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("parse-artists", help="Parse the local Street Parade HTML and write SoundCloud artist URLs")
    subparsers.add_parser("discover-tracks", help="Discover SoundCloud track URLs and write artist_links.json")
    download_parser = subparsers.add_parser("download", help="Download tracks from artist_links.json or a direct track URL")
    download_parser.add_argument("--num-links", type=int)
    download_parser.add_argument("--track-url", help="Download one SoundCloud track URL instead of reading artist_links.json")
    download_parser.add_argument("--artist", help="Optional cache bucket name for --track-url downloads")
    subparsers.add_parser("embed", help="Compute artist embeddings from downloaded tracks")
    subparsers.add_parser("run-all", help="Download listed tracks and compute embeddings")

    args = parser.parse_args(argv)
    config = build_config(args)

    if args.command == "parse-artists":
        artists = parse_artists_from_html(config.resolved_html_file)
        save_artist_links(
            {artist.name: [artist.soundcloud_url] for artist in artists if artist.soundcloud_url},
            config.resolved_links_file,
        )
        return 0
    if args.command == "discover-tracks":
        write_soundcloud_artist_links(config)
        return 0
    if args.command == "download":
        if args.track_url:
            result = download_single_track(config, args.track_url, artist=args.artist)
            status = "downloaded" if result.downloaded else "already cached"
            print(f"{status}: {result.path}")
        else:
            download_artist_tracks(config, num_links=args.num_links)
        return 0
    if args.command == "embed":
        results = compute_artist_embeddings(config)
        save_embedding_results(results, config.resolved_output_dir)
        return 0
    if args.command == "run-all":
        download_artist_tracks(config)
        results = compute_artist_embeddings(config)
        save_embedding_results(results, config.resolved_output_dir)
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
