from __future__ import annotations

from typing import TypeAlias

"""Compute per-artist set time slots from a love-mobile truck window.

A truck is active for a contiguous window like ``13:00 - 18:00`` and its
artists play in a fixed order. The sets are assumed to be equally long and to
cover the whole window, so artist *i* of ``N`` gets the slot
``[start + i * span, start + (i + 1) * span)``.
"""

Clock: TypeAlias = int  # minutes since midnight

SlotTimes: TypeAlias = tuple[str, str]


def parse_clock(value: str | None) -> Clock | None:
    """Parse ``HH:MM`` (or ``HH.MM``) into minutes since midnight.

    Args:
        value: Clock string such as ``"13:00"`` or ``"18.30"``.

    Returns:
        Minutes since midnight, or ``None`` for malformed input.
    """
    if not value:
        return None
    text = value.strip().replace(".", ":")
    parts = text.split(":")
    if len(parts) != 2:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours < 24) or not (0 <= minutes < 60):
        return None
    return hours * 60 + minutes


def format_clock(minutes: Clock) -> str:
    """Format minutes since midnight as ``HH:MM`` (wrapping 24h to 00:00)."""
    minutes = int(round(minutes))
    if minutes >= 24 * 60:
        minutes -= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def equal_set_times(time: str | None, count: int) -> list[SlotTimes | None]:
    """Split a truck's active window into ``count`` equal contiguous slots.

    Args:
        time: Truck window string such as ``"13:00 - 18:00"``.
        count: Number of artists playing on the truck.

    Returns:
        One ``(start, end)`` ``HH:MM`` pair per artist in play order, or a list
        of ``None`` values when the window is missing or unparseable.
    """
    if count <= 0:
        return []
    start = parse_window_start(time)
    end = parse_window_end(time)
    if start is None or end is None:
        return [None for _ in range(count)]
    if end <= start:
        end += 24 * 60
    span = (end - start) / count
    slots: list[SlotTimes | None] = []
    for index in range(count):
        slot_start = start + index * span
        slot_end = start + (index + 1) * span
        slots.append((format_clock(slot_start), format_clock(slot_end)))
    return slots


def parse_window(time: str | None) -> tuple[Clock | None, Clock | None]:
    """Parse the two clock bounds of a truck window string."""
    if not time:
        return None, None
    separator = None
    for candidate in (" - ", " – ", " — ", "-", "–", "—"):
        if candidate in time:
            separator = candidate
            break
    if separator is None:
        return None, None
    parts = time.split(separator, 1)
    if len(parts) != 2:
        return None, None
    return parse_clock(parts[0]), parse_clock(parts[1])


def parse_window_start(time: str | None) -> Clock | None:
    """Return the truck window start in minutes since midnight."""
    start, _ = parse_window(time)
    return start


def parse_window_end(time: str | None) -> Clock | None:
    """Return the truck window end in minutes since midnight."""
    _, end = parse_window(time)
    return end
