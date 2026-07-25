# Street Parade Embeddings

Reusable pipeline for collecting SoundCloud tracks and computing artist-level CLAP embeddings.

## Install

```bash
pip install -e .
```

For SoundCloud track discovery from rendered pages:

```bash
pip install -e '.[discovery]'
```

`pydub` requires `ffmpeg` to be installed on the system.

## Commands

Discover track URLs from `streetparade_data.html`:

```bash
streetparade-embeddings --data-dir . discover-tracks
```

Download cached MP3s for URLs in `artist_links.json`:

```bash
streetparade-embeddings --data-dir . download --num-links 3
```

Download a single SoundCloud track URL directly:

```bash
streetparade-embeddings --data-dir . download --track-url https://soundcloud.com/artist/track --artist "Artist Name"
```

If `--artist` is omitted, the downloader resolves the track page and uses the SoundCloud artist metadata.

Download a YouTube video as MP3:

```bash
streetparade-embeddings --data-dir . youtube-download --url https://www.youtube.com/watch?v=1Hx3PGeADmc
```

The YouTube downloader can also be run as a standalone module:

```bash
python -m streetparade_embeddings.youtube https://www.youtube.com/watch?v=1Hx3PGeADmc
```

Compute artist embeddings from downloaded tracks:

```bash
streetparade-embeddings --data-dir . --device auto embed
```

Outputs are written to `outputs/artist_embeddings.npz` and `outputs/artist_metadata.json` by default.

## Code Layout

- `src/streetparade_embeddings/audio.py`: audio loading, resampling, chunking, normalization.
- `src/streetparade_embeddings/soundcloud.py`: HTML parsing, SoundCloud track discovery, cache paths, downloads.
- `src/streetparade_embeddings/youtube.py`: YouTube metadata extraction, MP3 downloads, and cache paths.
- `src/streetparade_embeddings/embeddings.py`: lazy CLAP model wrapper and embedding aggregation.
- `src/streetparade_embeddings/pipeline.py`: orchestration for download and embedding runs.
- `src/streetparade_embeddings/cli.py`: command-line interface.

The notebooks are retained as exploration artifacts. New analysis should import package modules instead of redefining pipeline logic in notebook cells.

## Documentation

Build the Sphinx documentation locally:

```bash
pip install -e '.[docs]'
sphinx-build -b html docs docs/_build/html
```

The generated HTML entry point is `docs/_build/html/index.html`.
