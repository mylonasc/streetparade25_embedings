from __future__ import annotations

from typing import Any, Callable

from .db import connect
from .schemas import PreferenceRequest
from .user_visualization import get_or_create_user, normalize_username


def set_preference(username: str, payload: PreferenceRequest, now: Callable[[], str]) -> dict[str, Any]:
    """Create or update one visualization preference for a user.

    Args:
        username: Public username that owns the preference.
        payload: Preference target and value submitted by the client.
        now: Clock function used to populate ``updated_at``.

    Returns:
        Stored preference row plus the user's current non-cleared preferences.
    """
    user = get_or_create_user(username)
    timestamp = now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO user_preferences (
                user_id, username, point_id, target_kind, target_id, track_id, user_track_id, vector_id, value, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, target_kind, target_id) DO UPDATE SET
                username = excluded.username,
                point_id = excluded.point_id,
                track_id = excluded.track_id,
                user_track_id = excluded.user_track_id,
                vector_id = excluded.vector_id,
                value = excluded.value,
                updated_at = excluded.updated_at
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
        row = conn.execute(
            """
            SELECT * FROM user_preferences
            WHERE user_id = ? AND target_kind = ? AND target_id = ?
            """,
            (user["id"], payload.target_kind, payload.target_id),
        ).fetchone()
    return {**dict(row), "preferences": current_preferences(username)}


def current_preferences(username: str) -> dict[str, str]:
    """Load the current visible preferences for a user.

    Args:
        username: Public username whose preferences should be loaded.

    Returns:
        Mapping from stable preference keys to values, excluding cleared items.
    """
    username = normalize_username(username)
    user = get_or_create_user(username)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM user_preferences
            WHERE user_id = ?
            ORDER BY id
            """,
            (user["id"],),
        ).fetchall()
    return {
        preference_key(row["target_kind"], row["target_id"]): row["value"]
        for row in rows
        if row["value"] != "clear"
    }


def preference_key(target_kind: str, target_id: str) -> str:
    """Build the stable client-side key for a preference target.

    Args:
        target_kind: Target category, such as ``track`` or ``artist``.
        target_id: Target identifier within that category.

    Returns:
        Colon-delimited preference key.
    """
    return f"{target_kind}:{target_id}"
