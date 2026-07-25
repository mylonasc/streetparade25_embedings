from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.models import TrackDownload
from streetparade_embeddings.pipeline import download_single_track
from streetparade_embeddings.soundcloud import stable_hash


def test_download_single_track_uses_artist_cache_bucket(monkeypatch, tmp_path):
    calls = []
    track_url = "https://soundcloud.com/example/track"

    def fake_download_track_to_cache(url, cache_dir, artist=None):
        calls.append((url, cache_dir, artist))
        path = cache_dir / stable_hash(artist) / f"{stable_hash(url)}.mp3"
        return TrackDownload(artist=artist, url=url, path=path, downloaded=True)

    monkeypatch.setattr("streetparade_embeddings.pipeline.download_track_to_cache", fake_download_track_to_cache)

    result = download_single_track(PipelineConfig(data_dir=tmp_path), track_url, artist="Example Artist")

    expected_path = tmp_path / ".songs_cache" / stable_hash("Example Artist") / f"{stable_hash(track_url)}.mp3"
    assert calls == [(track_url, tmp_path / ".songs_cache", "Example Artist")]
    assert result.artist == "Example Artist"
    assert result.path == expected_path
    assert result.downloaded is True


def test_download_single_track_allows_artist_inference(monkeypatch, tmp_path):
    track_url = "https://soundcloud.com/example/track"

    def fake_download_track_to_cache(url, cache_dir, artist=None):
        assert artist is None
        path = cache_dir / stable_hash("Inferred Artist") / f"{stable_hash(url)}.mp3"
        return TrackDownload(artist="Inferred Artist", url=url, path=path, downloaded=True)

    monkeypatch.setattr("streetparade_embeddings.pipeline.download_track_to_cache", fake_download_track_to_cache)

    result = download_single_track(PipelineConfig(data_dir=tmp_path), track_url)

    assert result.artist == "Inferred Artist"
