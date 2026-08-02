from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.pipeline import download_single_track, download_youtube_track


INDEX_NAME = "media_index.json"


def load_manifest(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("media manifest must be a list")
    return data


def load_index(cache_dir: Path) -> dict[str, dict[str, Any]]:
    index_path = cache_dir / INDEX_NAME
    if not index_path.exists():
        return {}
    data = json.loads(index_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    return data


def write_index(cache_dir: Path, index: dict[str, dict[str, Any]]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / INDEX_NAME).write_text(json.dumps(index, indent=2, sort_keys=True), encoding="utf-8")


def cached_entry_is_valid(cache_dir: Path, entry: dict[str, Any], cached: dict[str, Any] | None) -> bool:
    if not cached:
        return False
    relative_path = cached.get("relative_path")
    if not isinstance(relative_path, str):
        return False
    path = cache_dir / relative_path
    return path.exists() and path.suffix == ".mp3" and path.stat().st_size >= int(entry.get("min_size_bytes", 1))


def download_entry(cache_dir: Path, entry: dict[str, Any]) -> dict[str, Any]:
    source = entry["source"]
    url = entry["url"]
    config = PipelineConfig(data_dir=cache_dir)

    if source == "youtube":
        result = download_youtube_track(config, url)
        artist = result.artist
        title = result.title
    elif source == "soundcloud":
        result = download_single_track(config, url)
        artist = result.artist
        title = ""
    else:
        raise ValueError(f"unsupported media fixture source: {source}")

    path = result.path
    if not path.exists():
        raise FileNotFoundError(f"download did not create expected file: {path}")
    min_size = int(entry.get("min_size_bytes", 1))
    size = path.stat().st_size
    if size < min_size:
        raise ValueError(f"downloaded file for {entry['name']} is too small: {size} < {min_size}")

    return {
        "name": entry["name"],
        "source": source,
        "url": url,
        "artist": artist,
        "title": title,
        "relative_path": str(path.relative_to(cache_dir)),
        "size_bytes": size,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: download_media_fixtures.py <manifest.json> <cache-dir>", file=sys.stderr)
        return 2

    manifest_path = Path(sys.argv[1])
    cache_dir = Path(sys.argv[2])
    manifest = load_manifest(manifest_path)
    index = load_index(cache_dir)

    for entry in manifest:
        name = entry["name"]
        cached = index.get(name)
        if cached_entry_is_valid(cache_dir, entry, cached):
            path = cache_dir / cached["relative_path"]
            cached["size_bytes"] = path.stat().st_size
            index[name] = cached
            print(f"cached {name}: {path}")
            continue

        downloaded = download_entry(cache_dir, entry)
        index[name] = downloaded
        print(f"downloaded {name}: {cache_dir / downloaded['relative_path']}")

    write_index(cache_dir, index)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
