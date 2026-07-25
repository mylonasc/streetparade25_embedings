"""Compatibility imports for older notebooks.

New code should import from ``streetparade_embeddings`` modules directly.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from streetparade_embeddings.audio import chunk_audio as _get_chunks
from streetparade_embeddings.audio import load_audio_mono as _process_mp3
from streetparade_embeddings.audio import preprocess_track as _preproc_track
from streetparade_embeddings.soundcloud import ArtistData
from streetparade_embeddings.soundcloud import download_track as _download_track
from streetparade_embeddings.soundcloud import stable_hash

SAMPLING_RATE = 48_000
MAX_CHUNKS = 3


def _store_track_to_file(track_url, file_path):
    output_path = Path(file_path) / f"{stable_hash(track_url)}.mp3"
    return _download_track(track_url, output_path)
