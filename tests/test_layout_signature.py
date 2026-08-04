import sqlite3

from streetparade_embeddings.db import connect, db_path, init_db
from streetparade_embeddings.routes.users import _table_fingerprint, visualization_signature


def _insert_completed_layout(conn, job_id: str) -> None:
    conn.execute(
        """
        INSERT INTO embedding_layouts (id, username, status, points_json, error, created_at, started_at, finished_at)
        VALUES (?, ?, 'completed', ?, NULL, ?, ?, ?)
        """,
        (job_id, "listener", '[{"x": 0.0, "y": 0.0}]', "2026-08-04T00:00:00+00:00", "2026-08-04T00:00:01+00:00", "2026-08-04T00:00:02+00:00"),
    )


def test_table_fingerprint_supports_embedding_layouts_time_column(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "layout.sqlite3"))
    init_db()
    with connect() as conn:
        fingerprint = _table_fingerprint(conn, "embedding_layouts", time_column="finished_at")
    assert fingerprint != ["embedding_layouts:unavailable"]
    assert fingerprint[0] == "embedding_layouts:0::"


def test_visualization_signature_changes_after_completed_layout(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "layout.sqlite3"))
    monkeypatch.setenv("STREETPARADE_VECTOR_STORE", "numpy")
    monkeypatch.setenv("STREETPARADE_NUMPY_VECTOR_DIR", str(tmp_path / "vectorstore"))
    init_db()

    before = visualization_signature("listener", True)
    with connect() as conn:
        _insert_completed_layout(conn, "job-1")
    after = visualization_signature("listener", True)

    assert before != after
    with connect() as conn:
        assert _table_fingerprint(conn, "embedding_layouts", time_column="finished_at") != ["embedding_layouts:unavailable"]


def test_visualization_signature_reflects_latest_layout(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "layout.sqlite3"))
    monkeypatch.setenv("STREETPARADE_VECTOR_STORE", "numpy")
    monkeypatch.setenv("STREETPARADE_NUMPY_VECTOR_DIR", str(tmp_path / "vectorstore"))
    init_db()

    with connect() as conn:
        _insert_completed_layout(conn, "job-1")
    first = visualization_signature("listener", True)
    with connect() as conn:
        _insert_completed_layout(conn, "job-2")
    second = visualization_signature("listener", True)

    assert first != second
    assert db_path().exists()
