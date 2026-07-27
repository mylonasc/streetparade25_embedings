import asyncio
import threading
import time
import sqlite3

import numpy as np

from streetparade_embeddings import api
from streetparade_embeddings.config import Device


def test_artist_api_matches_artist_model_metadata(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "artist.sqlite3"))

    async def run():
        created = await api.create_artist(
            api.ArtistCreate(
                name="Full Artist",
                links=["https://example.com", "https://soundcloud.com/full"],
                images=["https://example.com/image.jpg"],
                soundcloud_url="https://soundcloud.com/full",
                instagram="https://instagram.com/full",
                youtube="https://youtube.com/@full",
                web="https://example.com",
            )
        )
        updated = await api.create_artist(api.ArtistCreate(name="Full Artist", youtube="https://youtube.com/@updated"))
        return created, updated

    created, updated = asyncio.run(run())

    assert created["links"] == ["https://example.com", "https://soundcloud.com/full"]
    assert created["images"] == ["https://example.com/image.jpg"]
    assert created["instagram"] == "https://instagram.com/full"
    assert created["youtube"] == "https://youtube.com/@full"
    assert created["web"] == "https://example.com"
    assert updated["links"] == created["links"]
    assert updated["images"] == created["images"]
    assert updated["youtube"] == "https://youtube.com/@updated"


def test_artist_schema_migrates_existing_database(monkeypatch, tmp_path):
    db_path = tmp_path / "migration.sqlite3"
    monkeypatch.setenv("STREETPARADE_DB", str(db_path))
    now = api._now()
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE artists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                soundcloud_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO artists (name, soundcloud_url, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("Old Artist", "https://soundcloud.com/old", now, now),
        )

    api.init_db()

    async def run():
        artists = await api.list_artists()
        return artists[0]

    artist = asyncio.run(run())

    assert artist["name"] == "Old Artist"
    assert artist["links"] == []
    assert artist["images"] == []
    assert artist["soundcloud_url"] == "https://soundcloud.com/old"
    assert "instagram" in artist
    assert "youtube" in artist
    assert "web" in artist


def _insert_track(artist: str = "Artist", url: str = "https://soundcloud.com/a/t") -> int:
    api.init_db()
    now = api._now()
    with api._connect() as conn:
        conn.execute(
            "INSERT INTO artists (name, soundcloud_url, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (artist, None, now, now),
        )
        artist_id = conn.execute("SELECT id FROM artists WHERE name = ?", (artist,)).fetchone()["id"]
        conn.execute(
            """
            INSERT INTO tracks (artist_id, url, path, downloaded, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (artist_id, url, "/tmp/fake.mp3", 1, now, now),
        )
        return conn.execute("SELECT id FROM tracks WHERE url = ?", (url,)).fetchone()["id"]


def test_embedding_service_reuses_lazy_model(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "reuse.sqlite3"))
    track_id = _insert_track()

    class FakeModel:
        init_count = 0
        embed_count = 0

        def __init__(self, model_name, device):
            FakeModel.init_count += 1
            self.model_name = model_name
            self.device = device

        def embed_track(self, *args, **kwargs):
            FakeModel.embed_count += 1
            return np.array([1.0, 2.0], dtype=np.float32)

    async def run():
        service = api.LazyClapEmbeddingService(model_cls=FakeModel)
        try:
            first = await service.enqueue(api.ComputeRequest(only_missing=True, device=Device.CPU))
            while first.status in {"queued", "running"}:
                await asyncio.sleep(0.01)

            second = await service.enqueue(api.ComputeRequest(only_missing=False, device=Device.CPU))
            while second.status in {"queued", "running"}:
                await asyncio.sleep(0.01)
        finally:
            await service.stop()

    asyncio.run(run())

    assert FakeModel.init_count == 1
    assert FakeModel.embed_count == 2
    with api._connect() as conn:
        row = conn.execute("SELECT embedding_dim, embedding_model FROM tracks WHERE id = ?", (track_id,)).fetchone()
    assert row["embedding_dim"] == 2
    assert row["embedding_model"] == "laion/clap-htsat-unfused"


def test_embedding_job_can_be_cancelled_from_api(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "cancel.sqlite3"))
    track_id = _insert_track()
    started = threading.Event()

    class SlowFakeModel:
        def __init__(self, model_name, device):
            pass

        def embed_track(self, *args, **kwargs):
            started.set()
            time.sleep(0.1)
            return np.array([3.0, 4.0], dtype=np.float32)

    async def run():
        service = api.LazyClapEmbeddingService(model_cls=SlowFakeModel)
        monkeypatch.setattr(api, "embedding_service", service)
        try:
            created = await api.compute_embeddings(api.ComputeRequest(only_missing=True, device=Device.CPU))
            assert await asyncio.to_thread(started.wait, 2)

            cancelled = await api.cancel_embedding_job(created["id"])
            assert cancelled["status"] in {"cancelling", "cancelled"}

            while service.get_job(created["id"]).status in {"queued", "running", "cancelling"}:
                await asyncio.sleep(0.01)
            return service.get_job(created["id"]).as_dict()
        finally:
            await service.stop()

    job = asyncio.run(run())

    assert job["status"] == "cancelled"
    with api._connect() as conn:
        row = conn.execute("SELECT embedding FROM tracks WHERE id = ?", (track_id,)).fetchone()
    assert row["embedding"] is None
