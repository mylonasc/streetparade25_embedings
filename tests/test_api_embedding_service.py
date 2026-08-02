import asyncio
import threading
import time
import sqlite3

import numpy as np

from streetparade_embeddings import api
from streetparade_embeddings import repositories
from streetparade_embeddings.config import Device
from streetparade_embeddings.models import TrackDownload


class FakeVectorStore:
    def __init__(self):
        self.vectors = {}

    def upsert_embedding(self, vector_id, embedding, metadata):
        self.vectors[vector_id] = (embedding, metadata)
        return vector_id

    def get_embedding(self, vector_id):
        item = self.vectors.get(vector_id)
        if item is None:
            return None
        return item[0].astype(float).tolist()

    def query_by_vector(self, embedding, n_results=10, where=None):
        return []

    def query_by_embedding_ids(self, vector_ids, n_results=10, where=None):
        return []


def test_artist_api_matches_artist_model_metadata(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "artist.sqlite3"))

    async def run():
        created = await api.create_artist(
            api.ArtistCreate(
                name="Full Artist",
                links=["https://example.com", "https://soundcloud.com/full"],
                images=["https://example.com/image.jpg"],
                info=["Main Stage", "Label (ZH)"],
                socials=[{"platform": "facebook", "url": "https://facebook.com/full"}],
                bio="Artist biography",
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
    assert created["info"] == ["Main Stage", "Label (ZH)"]
    assert created["socials"] == [{"platform": "facebook", "url": "https://facebook.com/full"}]
    assert created["bio"] == "Artist biography"
    assert created["instagram"] == "https://instagram.com/full"
    assert created["youtube"] == "https://youtube.com/@full"
    assert created["web"] == "https://example.com"
    assert updated["links"] == created["links"]
    assert updated["images"] == created["images"]
    assert updated["info"] == created["info"]
    assert updated["socials"] == created["socials"]
    assert updated["bio"] == created["bio"]
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
    assert artist["info"] == []
    assert artist["socials"] == []
    assert artist["bio"] is None
    assert artist["soundcloud_url"] == "https://soundcloud.com/old"
    assert "instagram" in artist
    assert "youtube" in artist
    assert "web" in artist


def test_track_schema_migrates_download_status(monkeypatch, tmp_path):
    db_path = tmp_path / "track-migration.sqlite3"
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
            """
            CREATE TABLE tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                path TEXT,
                downloaded INTEGER NOT NULL DEFAULT 0,
                sample_count INTEGER NOT NULL DEFAULT 0,
                sampling_rate INTEGER,
                chunk_seconds INTEGER,
                chunk_stride_seconds INTEGER,
                max_chunks INTEGER,
                embedding BLOB,
                embedding_dim INTEGER,
                embedding_model TEXT,
                embedded_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(artist_id, url)
            )
            """
        )
        conn.execute(
            "INSERT INTO artists (name, soundcloud_url, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("Old Artist", None, now, now),
        )
        conn.execute(
            """
            INSERT INTO tracks (artist_id, url, path, downloaded, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (1, "https://soundcloud.com/a/t", "/tmp/track.mp3", 1, now, now),
        )

    api.init_db()

    with api._connect() as conn:
        row = conn.execute("SELECT download_status FROM tracks WHERE id = 1").fetchone()
    assert row["download_status"] == "completed"


def test_list_tracks_is_paged_for_python_api_and_repository(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "tracks.sqlite3"))

    async def run():
        artist = await api.create_artist(api.ArtistCreate(name="Paged Artist"))
        with api._connect() as conn:
            for index in range(3):
                repositories.upsert_track(
                    conn,
                    artist["id"],
                    f"https://example.com/{index}",
                    f"/tmp/{index}.mp3",
                    downloaded=True,
                    download_status="completed",
                    now=api._now,
                )
        first_page = await api.list_tracks(page=1, page_size=2)
        second_page = repositories.list_tracks(page=2, page_size=2)
        return first_page, second_page

    first_page, second_page = asyncio.run(run())

    assert first_page["page"] == 1
    assert first_page["page_size"] == 2
    assert first_page["total"] == 3
    assert first_page["has_next"] is True
    assert [track["url"] for track in first_page["tracks"]] == ["https://example.com/0", "https://example.com/1"]
    assert second_page["page"] == 2
    assert second_page["has_next"] is False
    assert [track["url"] for track in second_page["tracks"]] == ["https://example.com/2"]


def test_download_endpoint_queues_and_exposes_downloading_then_completed(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "download-status.sqlite3"))
    started = threading.Event()
    release = threading.Event()
    track_url = "https://soundcloud.com/example/track"

    def fake_download_track(url, path):
        started.set()
        release.wait(timeout=2)
        path.write_bytes(b"not real mp3")
        return TrackDownload(artist="Artist", url=url, path=path, downloaded=True)

    monkeypatch.setattr(api, "download_track", fake_download_track)

    async def run():
        service = api.DownloadService()
        monkeypatch.setattr(api, "download_service", service)
        try:
            artist = await api.create_artist(api.ArtistCreate(name="Download Artist"))
            job = await api.download_artist_tracks(
                artist["id"],
                api.DownloadRequest(max_tracks=1, track_urls=[track_url], cache_dir=str(tmp_path / "cache")),
            )
            assert job["status"] in {"queued", "running"}
            assert job["processed_count"] == 0
            assert (await api.list_download_jobs())[0]["id"] == job["id"]
            assert (await api.get_download_job(job["id"]))["id"] == job["id"]

            assert await asyncio.to_thread(started.wait, 2)
            tracks_while_downloading = await api.list_artist_tracks(artist["id"])
            release.set()
            while service.get_job(job["id"]).status in {"queued", "running", "cancelling"}:
                await asyncio.sleep(0.01)
            final_job = service.get_job(job["id"]).as_dict()
            tracks_after = await api.list_artist_tracks(artist["id"])
            return tracks_while_downloading, final_job, tracks_after
        finally:
            release.set()
            await service.stop()

    tracks_while_downloading, job, tracks_after = asyncio.run(run())

    assert tracks_while_downloading[0]["download_status"] == "downloading"
    assert tracks_while_downloading[0]["downloaded"] is False
    assert job["status"] == "completed"
    assert job["processed"][0]["download_status"] == "completed"
    assert tracks_after[0]["download_status"] == "completed"
    assert tracks_after[0]["downloaded"] is True


def test_download_job_can_be_cancelled_between_tracks(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "download-cancel.sqlite3"))
    calls = []
    started = threading.Event()
    release = threading.Event()
    track_urls = ["https://soundcloud.com/example/one", "https://soundcloud.com/example/two"]

    def fake_download_track(url, path):
        calls.append(url)
        started.set()
        release.wait(timeout=2)
        path.write_bytes(b"not real mp3")
        return TrackDownload(artist="Artist", url=url, path=path, downloaded=True)

    monkeypatch.setattr(api, "download_track", fake_download_track)

    async def run():
        service = api.DownloadService()
        monkeypatch.setattr(api, "download_service", service)
        try:
            artist = await api.create_artist(api.ArtistCreate(name="Cancel Download Artist"))
            job = await api.download_artist_tracks(
                artist["id"],
                api.DownloadRequest(max_tracks=2, track_urls=track_urls, cache_dir=str(tmp_path / "cache")),
            )
            assert await asyncio.to_thread(started.wait, 2)
            cancelled = await api.cancel_download_job(job["id"])
            assert cancelled["status"] in {"cancelling", "cancelled"}
            release.set()
            while service.get_job(job["id"]).status in {"queued", "running", "cancelling"}:
                await asyncio.sleep(0.01)
            tracks = await api.list_artist_tracks(artist["id"])
            return service.get_job(job["id"]).as_dict(), tracks
        finally:
            release.set()
            await service.stop()

    job, tracks = asyncio.run(run())

    assert job["status"] == "cancelled"
    assert calls == [track_urls[0]]
    assert len(tracks) == 1
    assert tracks[0]["download_status"] == "completed"


def test_download_job_reports_completed_with_errors(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "download-errors.sqlite3"))
    track_urls = ["https://soundcloud.com/example/ok", "https://soundcloud.com/example/fail"]

    def fake_download_track(url, path):
        if url.endswith("fail"):
            raise RuntimeError("boom")
        path.write_bytes(b"not real mp3")
        return TrackDownload(artist="Artist", url=url, path=path, downloaded=True)

    monkeypatch.setattr(api, "download_track", fake_download_track)

    async def run():
        service = api.DownloadService()
        monkeypatch.setattr(api, "download_service", service)
        try:
            artist = await api.create_artist(api.ArtistCreate(name="Partial Download Artist"))
            job = await api.download_artist_tracks(
                artist["id"],
                api.DownloadRequest(max_tracks=2, track_urls=track_urls, cache_dir=str(tmp_path / "cache")),
            )
            while service.get_job(job["id"]).status in {"queued", "running", "cancelling"}:
                await asyncio.sleep(0.01)
            tracks = await api.list_artist_tracks(artist["id"])
            return service.get_job(job["id"]).as_dict(), tracks
        finally:
            await service.stop()

    job, tracks = asyncio.run(run())

    assert job["status"] == "completed_with_errors"
    assert job["processed_count"] == 2
    assert [track["download_status"] for track in tracks] == ["completed", "failed"]
    assert tracks[1]["last_error"] == "boom"


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
    vector_store = FakeVectorStore()
    monkeypatch.setattr(repositories, "get_vector_store", lambda: vector_store)
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
        row = conn.execute("SELECT embedding_dim, embedding_model, embedding FROM tracks WHERE id = ?", (track_id,)).fetchone()
        embedding_row = conn.execute("SELECT vector_id, embedding_dim, embedding_model FROM track_embeddings WHERE track_id = ?", (track_id,)).fetchone()
    assert row["embedding_dim"] == 2
    assert row["embedding_model"] == "laion/clap-htsat-unfused"
    assert row["embedding"] is None
    assert embedding_row["embedding_dim"] == 2
    assert embedding_row["embedding_model"] == "laion/clap-htsat-unfused"
    assert embedding_row["vector_id"] in vector_store.vectors


def test_embedding_job_can_be_cancelled_from_api(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "cancel.sqlite3"))
    monkeypatch.setattr(repositories, "get_vector_store", lambda: FakeVectorStore())
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


def test_embedding_service_can_store_segment_embeddings(monkeypatch, tmp_path):
    monkeypatch.setenv("STREETPARADE_DB", str(tmp_path / "segments.sqlite3"))
    vector_store = FakeVectorStore()
    monkeypatch.setattr(repositories, "get_vector_store", lambda: vector_store)
    track_id = _insert_track(artist="Segment Artist", url="https://soundcloud.com/a/segment")
    with api._connect() as conn:
        conn.execute(
            "INSERT INTO track_samples (track_id, chunk_index, start_seconds, duration_seconds) VALUES (?, ?, ?, ?)",
            (track_id, 0, 0.0, 30.0),
        )
        conn.execute(
            "INSERT INTO track_samples (track_id, chunk_index, start_seconds, duration_seconds) VALUES (?, ?, ?, ?)",
            (track_id, 1, 60.0, 30.0),
        )

    class SegmentFakeModel:
        def __init__(self, model_name, device):
            pass

        def embed_track_segments(self, *args, **kwargs):
            return np.array([[1.0, 3.0], [5.0, 7.0]], dtype=np.float32)

    async def run():
        service = api.LazyClapEmbeddingService(model_cls=SegmentFakeModel)
        try:
            job = await service.enqueue(api.ComputeRequest(only_missing=False, compute_segment_embeddings=True, device=Device.CPU))
            while job.status in {"queued", "running"}:
                await asyncio.sleep(0.01)
            return job.as_dict()
        finally:
            await service.stop()

    job = asyncio.run(run())

    assert job["status"] == "completed"
    with api._connect() as conn:
        track_row = conn.execute("SELECT embedding_dim FROM track_embeddings WHERE track_id = ?", (track_id,)).fetchone()
        sample_rows = conn.execute("SELECT track_sample_id, embedding_dim, vector_id FROM sample_embeddings WHERE track_id = ? ORDER BY chunk_index", (track_id,)).fetchall()
    assert track_row["embedding_dim"] == 2
    assert len(sample_rows) == 2
    assert [row["embedding_dim"] for row in sample_rows] == [2, 2]
    assert all(row["vector_id"] in vector_store.vectors for row in sample_rows)
