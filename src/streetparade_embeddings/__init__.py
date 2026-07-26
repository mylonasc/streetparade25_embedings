"""Tools for collecting SoundCloud audio and computing artist embeddings."""

from .config import PipelineConfig
from .config import Device
from .models import Artist, ArtistEmbeddingResult, MediaDownload, MediaSource, TrackDownload
from .soundcloud import DiscoveryMethod

__all__ = [
    "Artist",
    "ArtistEmbeddingResult",
    "Device",
    "DiscoveryMethod",
    "MediaDownload",
    "MediaSource",
    "PipelineConfig",
    "TrackDownload",
]
