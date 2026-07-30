from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.models import MediaDownload, MediaSource
from streetparade_embeddings.pipeline import download_youtube_track
from streetparade_embeddings.soundcloud import stable_hash
from streetparade_embeddings.youtube import youtube_cache_path


def test_youtube_cache_path_uses_source_namespace(tmp_path):
    url = "https://www.youtube.com/watch?v=abc123"

    path = youtube_cache_path(tmp_path, "Example Channel", url)

    assert path == tmp_path / "youtube" / stable_hash("Example Channel") / f"{stable_hash(url)}.mp3"


def test_download_youtube_track_uses_pipeline_cache(monkeypatch, tmp_path):
    calls = []
    url = "https://www.youtube.com/watch?v=abc123"

    def fake_download_youtube_to_cache(video_url, cache_dir, artist=None):
        calls.append((video_url, cache_dir, artist))
        path = cache_dir / "youtube" / stable_hash("Inferred Channel") / f"{stable_hash(video_url)}.mp3"
        return MediaDownload(MediaSource.YOUTUBE, "Inferred Channel", "Example Title", video_url, path, True)

    monkeypatch.setattr("streetparade_embeddings.pipeline.download_youtube_to_cache", fake_download_youtube_to_cache)

    result = download_youtube_track(PipelineConfig(data_dir=tmp_path), url)

    assert calls == [(url, tmp_path / ".songs_cache", None)]
    assert result.source is MediaSource.YOUTUBE
    assert result.artist == "Inferred Channel"
    assert result.title == "Example Title"
