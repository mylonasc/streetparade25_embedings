from __future__ import annotations

from typing import Any, Callable

from .db import connect
from .schemas import PreferenceEventRequest
from .user_visualization import get_or_create_user, normalize_username


def record_preference_event(username: str, payload: PreferenceEventRequest, now: Callable[[], str]) -> dict[str, Any]:
    user = get_or_create_user(username)
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO preference_events (
                user_id, username, point_id, target_kind, target_id, track_id, user_track_id, vector_id, value, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                user["username"],
                payload.point_id,
                payload.target_kind,
                payload.target_id,
                payload.track_id,
                payload.user_track_id,
                payload.vector_id,
                payload.value,
                timestamp,
            ),
        )
        event_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        event = conn.execute("SELECT * FROM preference_events WHERE id = ?", (event_id,)).fetchone()
    return {**dict(event), "current": current_preferences(username)}


def current_preferences(username: str) -> dict[str, str]:
    username = normalize_username(username)
    user = get_or_create_user(username)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT pe.*
            FROM preference_events pe
            JOIN (
                SELECT target_kind, target_id, MAX(id) AS id
                FROM preference_events
                WHERE user_id = ?
                GROUP BY target_kind, target_id
            ) latest ON latest.id = pe.id
            ORDER BY pe.id
            """,
            (user["id"],),
        ).fetchall()
    return {
        preference_key(row["target_kind"], row["target_id"]): row["value"]
        for row in rows
        if row["value"] != "clear"
    }


def preference_key(target_kind: str, target_id: str) -> str:
    return f"{target_kind}:{target_id}"
