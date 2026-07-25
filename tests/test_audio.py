import numpy as np

from streetparade_embeddings.audio import chunk_audio


def test_chunk_audio_drops_incomplete_chunks():
    samples = np.arange(10)

    chunks = chunk_audio(samples, chunk_seconds=3, stride_seconds=3, sampling_rate=1)

    assert chunks.tolist() == [[0, 1, 2], [3, 4, 5], [6, 7, 8]]


def test_chunk_audio_returns_empty_when_too_short():
    samples = np.arange(2)

    chunks = chunk_audio(samples, chunk_seconds=3, stride_seconds=3, sampling_rate=1)

    assert chunks.shape == (0, 3)
