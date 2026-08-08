import sqlite3
import importlib.util
from pathlib import Path

import yaml


def load_import_love_mobiles():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "import_love_mobiles_2026.py"
    spec = importlib.util.spec_from_file_location("import_love_mobiles_2026", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.import_love_mobiles


def test_import_love_mobiles_creates_artists_and_links_idempotently(monkeypatch, tmp_path):
    db_path = tmp_path / "love-mobiles.sqlite3"
    yaml_path = tmp_path / "love-mobiles.yaml"
    monkeypatch.setenv("STREETPARADE_DB", str(db_path))
    import_love_mobiles = load_import_love_mobiles()
    yaml_path.write_text(
        yaml.safe_dump(
            {
                "source": "https://example.test/love-mobiles",
                "love_mobiles": [
                    {
                        "index": 1,
                        "number": 1,
                        "name": "Mobile One",
                        "title": "1. Mobile One",
                        "genres": "Techno",
                        "motto": "One",
                        "time": "13:00 - 18:00",
                        "description": "First mobile",
                        "image": {"src": "https://example.test/one.jpg", "alt": "One"},
                        "links": [{"text": "Tickets", "type": None, "url": "https://example.test/tickets"}],
                        "artists": [
                            {
                                "name": "Existing Artist",
                                "bio": "Existing bio from mobile",
                                "links": [{"type": "soundcloud", "url": "https://soundcloud.com/existing"}],
                            },
                            {
                                "name": "New Artist",
                                "bio": "New bio",
                                "links": [{"type": "instagram", "url": "https://instagram.com/new"}],
                            },
                        ],
                    },
                    {
                        "index": 2,
                        "number": 2,
                        "name": "Mobile Two",
                        "title": "2. Mobile Two",
                        "artists": [
                            {
                                "name": "Existing Artist",
                                "bio": "Second mobile bio",
                                "links": [{"type": "website", "url": "https://existing.example"}],
                            }
                        ],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    first = import_love_mobiles(yaml_path)
    second = import_love_mobiles(yaml_path)

    assert first == {"love_mobiles": 2, "artist_love_mobile_links": 3, "artists_created_or_updated": 3}
    assert second == first
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        assert conn.execute("SELECT COUNT(*) AS count FROM love_mobiles").fetchone()["count"] == 2
        assert conn.execute("SELECT COUNT(*) AS count FROM artists").fetchone()["count"] == 2
        assert conn.execute("SELECT COUNT(*) AS count FROM artist_love_mobiles").fetchone()["count"] == 3

        existing = conn.execute("SELECT * FROM artists WHERE name = ?", ("Existing Artist",)).fetchone()
        new = conn.execute("SELECT * FROM artists WHERE name = ?", ("New Artist",)).fetchone()
        assert existing["soundcloud_url"] == "https://soundcloud.com/existing"
        assert existing["web"] == "https://existing.example"
        assert new["instagram"] == "https://instagram.com/new"

        mobile_rows = conn.execute(
            """
            SELECT lm.number
            FROM artist_love_mobiles alm
            JOIN love_mobiles lm ON lm.id = alm.love_mobile_id
            WHERE alm.artist_id = ?
            ORDER BY lm.number
            """,
            (existing["id"],),
        ).fetchall()
        assert [row["number"] for row in mobile_rows] == [1, 2]

        slots = conn.execute(
            """
            SELECT alm.artist_name, alm.set_order, alm.set_start, alm.set_end
            FROM artist_love_mobiles alm
            JOIN love_mobiles lm ON lm.id = alm.love_mobile_id
            WHERE lm.number = 1
            ORDER BY alm.set_order
            """
        ).fetchall()
        assert [(row["artist_name"], row["set_order"]) for row in slots] == [
            ("Existing Artist", 0),
            ("New Artist", 1),
        ]
        assert slots[0]["set_start"] == "13:00"
        assert slots[0]["set_end"] == "15:30"
        assert slots[1]["set_start"] == "15:30"
        assert slots[1]["set_end"] == "18:00"

        mobile_two_slots = conn.execute(
            """
            SELECT alm.set_order, alm.set_start, alm.set_end
            FROM artist_love_mobiles alm
            JOIN love_mobiles lm ON lm.id = alm.love_mobile_id
            WHERE lm.number = 2
            """
        ).fetchall()
        assert mobile_two_slots[0]["set_order"] == 0
        assert mobile_two_slots[0]["set_start"] is None
        assert mobile_two_slots[0]["set_end"] is None
