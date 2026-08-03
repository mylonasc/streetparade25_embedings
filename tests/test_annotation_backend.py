from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANNOTATION_BACKEND = ROOT / "ml_pipeline" / "1_labeling" / "backend"
sys.path.insert(0, str(ANNOTATION_BACKEND))

from app import annotation_repositories as repo  # noqa: E402
from app.db import set_database_path  # noqa: E402


def seed_track_with_samples(db_path: Path) -> tuple[int, list[int]]:
    set_database_path(db_path)
    timestamp = repo.now()
    with repo.connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS artists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE,
                name TEXT NOT NULL UNIQUE,
                links TEXT NOT NULL DEFAULT '[]',
                images TEXT NOT NULL DEFAULT '[]',
                info TEXT NOT NULL DEFAULT '[]',
                socials TEXT NOT NULL DEFAULT '[]',
                soundcloud_url TEXT,
                instagram TEXT,
                youtube TEXT,
                web TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE,
                artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                path TEXT,
                downloaded INTEGER NOT NULL DEFAULT 0,
                download_status TEXT NOT NULL DEFAULT 'not_started',
                sample_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(artist_id, url)
            );

            CREATE TABLE IF NOT EXISTS track_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                start_seconds REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                UNIQUE(track_id, chunk_index)
            );
            """
        )
        conn.execute(
            """
            INSERT INTO artists (uuid, name, links, images, info, socials, soundcloud_url, created_at, updated_at)
            VALUES (?, ?, '[]', '[]', '[]', '[]', ?, ?, ?)
            """,
            ("artist-uuid", "Annotation Artist", "https://soundcloud.com/annotation-artist", timestamp, timestamp),
        )
        artist_id = conn.execute("SELECT id FROM artists WHERE name = ?", ("Annotation Artist",)).fetchone()["id"]
        conn.execute(
            """
            INSERT INTO tracks (uuid, artist_id, url, path, downloaded, download_status, sample_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, 'completed', 2, ?, ?)
            """,
            ("track-uuid", artist_id, "https://example.com/track", "/tmp/track.mp3", timestamp, timestamp),
        )
        track_id = conn.execute("SELECT id FROM tracks WHERE url = ?", ("https://example.com/track",)).fetchone()["id"]
        for index in range(2):
            conn.execute(
                "INSERT INTO track_samples (track_id, chunk_index, start_seconds, duration_seconds) VALUES (?, ?, ?, ?)",
                (track_id, index, index * 30.0, 30.0),
            )
        sample_ids = [row["id"] for row in conn.execute("SELECT id FROM track_samples WHERE track_id = ? ORDER BY id", (track_id,))]
    return track_id, sample_ids


def test_annotation_campaign_allows_multiple_labels_per_segment(tmp_path):
    db_path = tmp_path / "annotation.sqlite3"
    track_id, sample_ids = seed_track_with_samples(db_path)

    campaign = repo.create_annotation_campaign("Genre pass", "Multi-label campaign")
    genre = repo.create_label_set(campaign["id"], "genre", None)
    mood = repo.create_label_set(campaign["id"], "mood", None)
    techno = repo.create_label(genre["id"], "techno", None, "#ff00aa")
    dark = repo.create_label(mood["id"], "dark", None, "#222222")

    items = repo.add_campaign_items(campaign["id"], [track_id], [])
    first = repo.assign_label(campaign["id"], sample_ids[0], techno["id"])
    second = repo.assign_label(campaign["id"], sample_ids[0], dark["id"])
    duplicate = repo.assign_label(campaign["id"], sample_ids[0], techno["id"], notes="updated")
    assignments = repo.list_assignments(campaign["id"])
    samples = repo.list_campaign_samples(campaign["id"])

    assert len(items) == 2
    assert first["id"] == duplicate["id"]
    assert second["id"] != first["id"]
    assert len(assignments) == 2
    assert {assignment["label_name"] for assignment in assignments} == {"techno", "dark"}
    assert samples[0]["sound_segment_id"] == sample_ids[0]
    assert samples[0]["track_title"] == "Track"
    assert samples[0]["artist_name"] == "Annotation Artist"
    assert samples[0]["artist_url"] == "https://soundcloud.com/annotation-artist"
    assert samples[0]["start_time"] == 0.0
    assert samples[0]["end_time"] == 30.0
    assert len(samples[0]["assignments"]) == 2


def test_annotation_facade_can_switch_database_paths(tmp_path):
    first_db = tmp_path / "first.sqlite3"
    second_db = tmp_path / "second.sqlite3"

    set_database_path(first_db)
    repo.create_annotation_campaign("First", None)
    assert [campaign["name"] for campaign in repo.list_annotation_campaigns()] == ["First"]

    set_database_path(second_db)
    assert repo.list_annotation_campaigns() == []
    repo.create_annotation_campaign("Second", None)
    assert [campaign["name"] for campaign in repo.list_annotation_campaigns()] == ["Second"]

    set_database_path(first_db)
    assert [campaign["name"] for campaign in repo.list_annotation_campaigns()] == ["First"]


def test_resolve_audio_path_remaps_host_song_cache_path(monkeypatch, tmp_path):
    db_path = tmp_path / "annotation.sqlite3"
    audio_root = tmp_path / "container-cache"
    cached_track = audio_root / "artist-bucket" / "track.mp3"
    cached_track.parent.mkdir(parents=True)
    cached_track.write_bytes(b"fake mp3")
    monkeypatch.setenv("ANNOTATION_AUDIO_ROOTS", str(audio_root))
    set_database_path(db_path)

    resolved = repo.resolve_audio_path("/home/user/project/.songs_cache/artist-bucket/track.mp3")

    assert resolved == cached_track


def test_remove_campaign_item_removes_segment_and_its_assignments(tmp_path):
    db_path = tmp_path / "annotation-remove.sqlite3"
    track_id, sample_ids = seed_track_with_samples(db_path)
    campaign = repo.create_annotation_campaign("Cleanup", None)
    label_set = repo.create_label_set(campaign["id"], "genre", None)
    label = repo.create_label(label_set["id"], "house", None, None)
    items = repo.add_campaign_items(campaign["id"], [track_id], [])
    repo.assign_label(campaign["id"], sample_ids[0], label["id"])

    removed = repo.remove_campaign_item(campaign["id"], items[0]["id"])
    remaining_samples = repo.list_campaign_samples(campaign["id"])
    remaining_assignments = repo.list_assignments(campaign["id"])

    assert removed["track_sample_id"] == sample_ids[0]
    assert [sample["track_sample_id"] for sample in remaining_samples] == [sample_ids[1]]
    assert remaining_assignments == []
