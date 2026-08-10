from streetparade_embeddings.app_factory import cors_origin_regex, cors_origins


def test_empty_cors_origin_regex_disables_regex(monkeypatch):
    monkeypatch.setenv("STREETPARADE_CORS_ORIGIN_REGEX", "")

    assert cors_origin_regex() is None


def test_empty_cors_origins_returns_empty_list(monkeypatch):
    monkeypatch.setenv("STREETPARADE_CORS_ORIGINS", "")

    assert cors_origins() == []
