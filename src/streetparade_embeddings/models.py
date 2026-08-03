from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TypeAlias

import numpy as np
from numpy.typing import NDArray

AudioEmbedding: TypeAlias = NDArray[np.floating]


class MediaSource(str, Enum):
    """External media platforms supported by the downloader."""

    SOUNDCLOUD = "soundcloud"
    YOUTUBE = "youtube"

    @classmethod
    def from_value(cls, value: "MediaSource | str") -> "MediaSource":
        """Normalize a string or enum value to a :class:`MediaSource`.

        Args:
            value: Existing enum value or source string.

        Returns:
            The matching media source enum.

        Raises:
            ValueError: If ``value`` is not a supported media source.
        """
        if isinstance(value, cls):
            return value
        try:
            return cls(value)
        except ValueError as exc:
            allowed = ", ".join(source.value for source in cls)
            raise ValueError(f"media source must be one of: {allowed}") from exc


@dataclass(frozen=True)
class Artist:
    """Artist metadata parsed from Street Parade data sources."""

    name: str
    links: list[str]
    images: list[str]
    soundcloud_url: str | None = None
    instagram : str | None = None
    youtube : str  | None = None
    web : str | None = None


@dataclass(frozen=True)
class TrackDownload:
    """Result of downloading or resolving a SoundCloud track cache file."""

    artist: str
    url: str
    path: Path
    downloaded: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", Path(self.path))


@dataclass(frozen=True)
class MediaDownload:
    """Result of downloading or resolving a media item from any source."""

    source: MediaSource
    artist: str
    title: str
    url: str
    path: Path
    downloaded: bool

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", MediaSource.from_value(self.source))
        object.__setattr__(self, "path", Path(self.path))


@dataclass(frozen=True)
class ArtistEmbeddingResult:
    """Computed embedding and processing metadata for one artist."""

    artist: str
    embedding: AudioEmbedding | None
    track_paths: list[Path]
    errors: list[str]

    def __post_init__(self) -> None:
        object.__setattr__(self, "track_paths", [Path(path) for path in self.track_paths])
