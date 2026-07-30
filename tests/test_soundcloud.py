import sys
from types import SimpleNamespace

from streetparade_embeddings.soundcloud import DiscoveryMethod, SoundCloudTrackDiscoverer
from streetparade_embeddings.soundcloud import artist_cache_dir, discover_track_urls_sync, discover_track_urls_ytdlp
from streetparade_embeddings.soundcloud import stable_hash, track_cache_path


def test_cache_paths_are_stable_hashes(tmp_path):
    artist = "Example Artist"
    url = "https://soundcloud.com/example/track"

    assert artist_cache_dir(tmp_path, artist) == tmp_path / stable_hash(artist)
    assert track_cache_path(tmp_path, artist, url) == tmp_path / stable_hash(artist) / f"{stable_hash(url)}.mp3"


def test_ytdlp_discovery_returns_track_urls(monkeypatch):
    class FakeYoutubeDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download=False):
            assert url == "https://soundcloud.com/example"
            assert download is False
            assert self.opts["extract_flat"] is True
            return {
                "entries": [
                    {"url": "https://soundcloud.com/example/track-1"},
                    {"webpage_url": "https://soundcloud.com/example/track-2"},
                    {"url": "not-a-url"},
                    {},
                ]
            }

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=FakeYoutubeDL))

    assert discover_track_urls_ytdlp("https://soundcloud.com/example") == [
        "https://soundcloud.com/example/track-1",
        "https://soundcloud.com/example/track-2",
    ]


def test_discoverer_selects_ytdlp_backend(monkeypatch):
    calls = []

    def fake_discover_track_urls_ytdlp(url):
        calls.append(url)
        return ["https://soundcloud.com/example/track"]

    monkeypatch.setattr("streetparade_embeddings.soundcloud.discover_track_urls_ytdlp", fake_discover_track_urls_ytdlp)

    discoverer = SoundCloudTrackDiscoverer(method=DiscoveryMethod.YT_DLP)

    assert discoverer.discover("https://soundcloud.com/example") == ["https://soundcloud.com/example/track"]
    assert calls == ["https://soundcloud.com/example"]


def test_discover_track_urls_sync_accepts_method(monkeypatch):
    monkeypatch.setattr(
        "streetparade_embeddings.soundcloud.discover_track_urls_ytdlp",
        lambda url: [f"{url}/track"],
    )

    assert discover_track_urls_sync("https://soundcloud.com/example", method=DiscoveryMethod.YT_DLP) == [
        "https://soundcloud.com/example/track"
    ]


def test_discoverer_accepts_string_backend_alias(monkeypatch):
    monkeypatch.setattr(
        "streetparade_embeddings.soundcloud.discover_track_urls_ytdlp",
        lambda url: [f"{url}/track"],
    )

    discoverer = SoundCloudTrackDiscoverer(method="yt-dlp")

    assert discoverer.method is DiscoveryMethod.YT_DLP
    assert discoverer.discover("https://soundcloud.com/example") == ["https://soundcloud.com/example/track"]


def test_discoverer_rejects_unknown_backend():
    try:
        SoundCloudTrackDiscoverer(method="unknown")
    except ValueError as exc:
        assert "discovery method must be" in str(exc)
    else:
        raise AssertionError("Expected ValueError")
