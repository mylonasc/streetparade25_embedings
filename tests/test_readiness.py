import numpy as np

from streetparade_embeddings.db import init_db
from streetparade_embeddings.routes.catalog import readiness_status
from streetparade_embeddings.vectorstore import write_numpy_store


def test_readiness_fails_when_numpy_vector_store_is_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "ready.sqlite3"))
    monkeypatch.setenv("STREETPARADE_VECTOR_STORE", "numpy")
    monkeypatch.setenv("STREETPARADE_NUMPY_VECTOR_DIR", str(tmp_path / "vectorstore"))
    init_db()

    status = readiness_status()

    assert status["status"] == "not_ready"
    assert status["checks"]["database"]["ok"] is True
    assert status["checks"]["vector_store"]["ok"] is False
    assert sorted(status["checks"]["vector_store"]["missing"]) == ["ids", "metadata", "vectors"]


def test_readiness_passes_with_database_and_numpy_vector_store(monkeypatch, tmp_path):
    vectorstore_dir = tmp_path / "vectorstore"
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "ready.sqlite3"))
    monkeypatch.setenv("STREETPARADE_VECTOR_STORE", "numpy")
    monkeypatch.setenv("STREETPARADE_NUMPY_VECTOR_DIR", str(vectorstore_dir))
    init_db()
    write_numpy_store(
        vectorstore_dir,
        ["track-1"],
        np.asarray([[1.0, 0.0]], dtype=np.float32),
        [{"track_id": 1}],
    )

    status = readiness_status()

    assert status["status"] == "ok"
    assert status["checks"]["database"]["ok"] is True
    assert status["checks"]["vector_store"]["ok"] is True
    assert status["checks"]["vector_store"]["vectors"] == 1
