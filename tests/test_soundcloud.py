from streetparade_embeddings.soundcloud import artist_cache_dir, stable_hash, track_cache_path


def test_cache_paths_are_stable_hashes(tmp_path):
    artist = "Example Artist"
    url = "https://soundcloud.com/example/track"

    assert artist_cache_dir(tmp_path, artist) == tmp_path / stable_hash(artist)
    assert track_cache_path(tmp_path, artist, url) == tmp_path / stable_hash(artist) / f"{stable_hash(url)}.mp3"
