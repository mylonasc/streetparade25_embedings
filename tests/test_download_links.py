from __future__ import annotations

import os
from pathlib import Path

import pytest

from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.pipeline import download_single_track, download_youtube_track


LINKS_FILE = Path(__file__).with_name("test_links.txt")


pytestmark = pytest.mark.live_download


def _require_live_downloads_enabled() -> None:
    if os.environ.get("RUN_LIVE_DOWNLOAD_TESTS") != "1":
        pytest.skip("set RUN_LIVE_DOWNLOAD_TESTS=1 to run live media download tests")


def _load_test_links() -> list[str]:
    return [line.strip() for line in LINKS_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]


def _assert_downloaded_mp3(path: Path) -> None:
    assert path.exists(), f"expected downloaded file at {path}"
    assert path.suffix == ".mp3"
    assert path.stat().st_size > 0


def test_links_file_contains_youtube_and_soundcloud_links() -> None:
    links = _load_test_links()

    assert any("youtube.com" in link or "youtu.be" in link for link in links)
    assert any("soundcloud.com" in link for link in links)


@pytest.mark.parametrize("url", [link for link in _load_test_links() if "youtube.com" in link or "youtu.be" in link])
def test_download_youtube_links_from_test_file(url: str, tmp_path: Path) -> None:
    _require_live_downloads_enabled()
    config = PipelineConfig(data_dir=tmp_path)

    first = download_youtube_track(config, url)
    second = download_youtube_track(config, url)

    _assert_downloaded_mp3(first.path)
    assert first.source.value == "youtube"
    assert first.url == url
    assert first.artist
    assert second.path == first.path
    assert second.downloaded is False


@pytest.mark.parametrize("url", [link for link in _load_test_links() if "soundcloud.com" in link])
def test_download_soundcloud_links_from_test_file(url: str, tmp_path: Path) -> None:
    _require_live_downloads_enabled()
    config = PipelineConfig(data_dir=tmp_path)

    first = download_single_track(config, url)
    second = download_single_track(config, url)

    _assert_downloaded_mp3(first.path)
    assert first.url == url
    assert first.artist
    assert second.path == first.path
    assert second.downloaded is False
