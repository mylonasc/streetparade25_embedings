from __future__ import annotations

import json
import os
from pathlib import Path


MANIFEST_PATH = Path(__file__).parent / "fixtures" / "media_manifest.json"


def _cache_dir() -> Path:
    return Path(os.environ.get("MEDIA_FIXTURE_CACHE", ".ci-media-cache"))


def test_media_fixture_cache_contains_manifest_entries() -> None:
    cache_dir = _cache_dir()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    index_path = cache_dir / "media_index.json"

    assert index_path.exists(), f"missing media fixture index: {index_path}"
    index = json.loads(index_path.read_text(encoding="utf-8"))

    for entry in manifest:
        cached = index.get(entry["name"])
        assert cached, f"missing cached entry for {entry['name']}"
        assert cached["source"] == entry["source"]
        assert cached["url"] == entry["url"]

        media_path = cache_dir / cached["relative_path"]
        assert media_path.exists(), f"missing cached media file: {media_path}"
        assert media_path.suffix == ".mp3"
        assert media_path.stat().st_size >= entry["min_size_bytes"]


def test_media_fixture_cache_has_youtube_and_soundcloud_samples() -> None:
    index_path = _cache_dir() / "media_index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    sources = {entry["source"] for entry in index.values()}

    assert "youtube" in sources
    assert "soundcloud" in sources
