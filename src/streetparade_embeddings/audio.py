from __future__ import annotations

from pathlib import Path

import numpy as np

DEFAULT_SAMPLING_RATE = 48_000


def load_audio_mono(path: str | Path, sampling_rate: int = DEFAULT_SAMPLING_RATE) -> np.ndarray:
    """Load an audio file, resample it, convert it to mono, and return int16 samples."""

    try:
        from pydub import AudioSegment
    except ImportError as exc:
        raise RuntimeError("Audio loading requires pydub and a system ffmpeg installation") from exc

    input_path = Path(path)
    if not input_path.exists():
        raise FileNotFoundError(f"Audio file does not exist: {input_path}")

    audio = AudioSegment.from_file(input_path)
    audio = audio.set_frame_rate(sampling_rate).set_channels(1)
    return np.array(audio.get_array_of_samples())


def chunk_audio(
    samples: np.ndarray,
    chunk_seconds: int = 30,
    stride_seconds: int = 60,
    sampling_rate: int = DEFAULT_SAMPLING_RATE,
) -> np.ndarray:
    """Split audio samples into equal-size chunks, dropping incomplete trailing chunks."""

    samples_per_chunk = chunk_seconds * sampling_rate
    stride_samples = stride_seconds * sampling_rate
    if samples_per_chunk <= 0 or stride_samples <= 0:
        raise ValueError("chunk_seconds and stride_seconds must be positive")
    if samples.shape[0] < samples_per_chunk:
        return np.empty((0, samples_per_chunk), dtype=samples.dtype)

    chunks = [samples[start : start + samples_per_chunk] for start in range(0, samples.shape[0], stride_samples)]
    chunks = [chunk for chunk in chunks if chunk.shape[0] == samples_per_chunk]
    if not chunks:
        return np.empty((0, samples_per_chunk), dtype=samples.dtype)
    return np.vstack(chunks)


def preprocess_track(
    path: str | Path,
    sampling_rate: int = DEFAULT_SAMPLING_RATE,
    chunk_seconds: int = 30,
    stride_seconds: int = 60,
    max_chunks: int | None = None,
) -> list[np.ndarray]:
    """Load a track and return normalized float chunks suitable for CLAP."""

    samples = load_audio_mono(path, sampling_rate=sampling_rate)
    chunks = chunk_audio(
        samples,
        chunk_seconds=chunk_seconds,
        stride_seconds=stride_seconds,
        sampling_rate=sampling_rate,
    )
    if max_chunks is not None:
        chunks = chunks[:max_chunks]
    return [chunk.astype(np.float32) / 32768.0 for chunk in chunks]
