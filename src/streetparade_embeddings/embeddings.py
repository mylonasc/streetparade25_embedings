from __future__ import annotations

from pathlib import Path

import numpy as np

from .audio import DEFAULT_SAMPLING_RATE, preprocess_track
from .config import Device
from .models import AudioEmbedding


class ClapEmbeddingModel:
    """Lazy CLAP wrapper for track and artist embeddings."""

    def __init__(self, model_name: str = "laion/clap-htsat-unfused", device: Device | str = Device.AUTO):
        """Load a CLAP model and processor for audio embedding.

        Args:
            model_name: Hugging Face model name or local model path.
            device: Inference device or ``Device.AUTO`` to prefer CUDA when
                available.
        """
        import torch
        from transformers import ClapModel, ClapProcessor

        resolved_device = Device.from_value(device)
        if resolved_device is Device.AUTO:
            device_name = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            device_name = resolved_device.value
        self.device = device_name
        self.model = ClapModel.from_pretrained(model_name).to(device_name)
        self.processor = ClapProcessor.from_pretrained(model_name)
        self.model.eval()

    def embed_chunks(self, chunks: list[np.ndarray], sampling_rate: int = DEFAULT_SAMPLING_RATE) -> AudioEmbedding:
        """Embed chunks and average them into one track-level vector.

        Args:
            chunks: Mono audio chunks as float arrays.
            sampling_rate: Sampling rate expected by the CLAP processor.

        Returns:
            Mean CLAP embedding across all chunks.

        Raises:
            ValueError: If ``chunks`` is empty.
        """
        chunk_embeddings = self.embed_chunk_batch(chunks, sampling_rate=sampling_rate)
        return chunk_embeddings.mean(axis=0)

    def embed_chunk_batch(self, chunks: list[np.ndarray], sampling_rate: int = DEFAULT_SAMPLING_RATE) -> np.ndarray:
        """Embed a batch of audio chunks.

        Args:
            chunks: Mono audio chunks as float arrays.
            sampling_rate: Sampling rate expected by the CLAP processor.

        Returns:
            Two-dimensional array with one embedding row per chunk.

        Raises:
            ValueError: If ``chunks`` is empty.
        """
        if not chunks:
            raise ValueError("Cannot embed a track with no complete audio chunks")

        import torch

        inputs = self.processor(audio=chunks, sampling_rate=sampling_rate, return_tensors="pt").to(self.device)
        with torch.no_grad():
            audio_embed = self.model.get_audio_features(**inputs)
        return audio_embed.pooler_output.cpu().numpy()

    def embed_track(
        self,
        track_path: str | Path,
        sampling_rate: int = DEFAULT_SAMPLING_RATE,
        chunk_seconds: int = 30,
        stride_seconds: int = 60,
        max_chunks: int = 10,
    ) -> AudioEmbedding:
        """Preprocess and embed one audio file as a single vector.

        Args:
            track_path: Path to an audio file readable by pydub/ffmpeg.
            sampling_rate: Sampling rate used for preprocessing and CLAP input.
            chunk_seconds: Length of each analyzed audio chunk.
            stride_seconds: Step between chunk starts.
            max_chunks: Maximum number of chunks to embed.

        Returns:
            Mean CLAP embedding for the track.
        """
        chunks = preprocess_track(
            track_path,
            sampling_rate=sampling_rate,
            chunk_seconds=chunk_seconds,
            stride_seconds=stride_seconds,
            max_chunks=max_chunks,
        )
        return self.embed_chunks(chunks, sampling_rate=sampling_rate)

    def embed_track_segments(
        self,
        track_path: str | Path,
        sampling_rate: int = DEFAULT_SAMPLING_RATE,
        chunk_seconds: int = 30,
        stride_seconds: int = 60,
        max_chunks: int = 10,
    ) -> np.ndarray:
        """Preprocess and embed one audio file chunk-by-chunk.

        Args:
            track_path: Path to an audio file readable by pydub/ffmpeg.
            sampling_rate: Sampling rate used for preprocessing and CLAP input.
            chunk_seconds: Length of each analyzed audio chunk.
            stride_seconds: Step between chunk starts.
            max_chunks: Maximum number of chunks to embed.

        Returns:
            Two-dimensional array with one embedding row per audio chunk.
        """
        chunks = preprocess_track(
            track_path,
            sampling_rate=sampling_rate,
            chunk_seconds=chunk_seconds,
            stride_seconds=stride_seconds,
            max_chunks=max_chunks,
        )
        return self.embed_chunk_batch(chunks, sampling_rate=sampling_rate)


def aggregate_embeddings(embeddings: list[AudioEmbedding]) -> AudioEmbedding | None:
    """Average multiple embedding vectors.

    Args:
        embeddings: Embedding vectors with matching dimensions.

    Returns:
        Mean embedding, or ``None`` when no embeddings are supplied.
    """
    if not embeddings:
        return None
    return np.mean(np.vstack(embeddings), axis=0)
