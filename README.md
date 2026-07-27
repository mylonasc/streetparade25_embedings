# Street Parade Embeddings

Reusable pipeline for collecting SoundCloud tracks and computing artist-level CLAP embeddings.

## Install

```bash
pip install -e .
```

For SoundCloud track discovery from rendered pages with the legacy `requests-html` backend:

```bash
pip install -e '.[discovery]'
```

`pydub` requires `ffmpeg` to be installed on the system.

## Commands

Discover track URLs from `streetparade_data.html`:

```bash
streetparade-embeddings --data-dir . discover-tracks --method yt-dlp
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

In Python code, select SoundCloud artist-page discovery backends with the enum:

```python
from streetparade_embeddings.soundcloud import DiscoveryMethod, SoundCloudTrackDiscoverer

discoverer = SoundCloudTrackDiscoverer(method=DiscoveryMethod.YT_DLP)
track_urls = discoverer.discover("https://soundcloud.com/hilitkolet")
```

Compute artist embeddings from downloaded tracks:

```bash
streetparade-embeddings --data-dir . --device auto embed
```

Outputs are written to `outputs/artist_embeddings.npz` and `outputs/artist_metadata.json` by default.

## API Server

Run the FastAPI server with SQLite metadata storage:

```bash
STREETPARADE_DB=streetparade_embeddings.sqlite3 uvicorn streetparade_embeddings.api:app --reload
```

Example flow:

```bash
curl -X POST http://127.0.0.1:8000/artists \
  -H 'Content-Type: application/json' \
  -d '{"name":"Hilit Kolet","links":["https://soundcloud.com/hilitkolet"],"images":[],"soundcloud_url":"https://soundcloud.com/hilitkolet","instagram":null,"youtube":null,"web":null}'

curl -X POST http://127.0.0.1:8000/artists/1/download \
  -H 'Content-Type: application/json' \
  -d '{"max_tracks":5,"discovery_method":"yt-dlp"}'

curl -X POST http://127.0.0.1:8000/artists/1/embeddings/compute \
  -H 'Content-Type: application/json' \
  -d '{"only_missing":true,"device":"auto"}'

curl http://127.0.0.1:8000/embedding-jobs/<job-id>

curl -X POST http://127.0.0.1:8000/embedding-jobs/<job-id>/cancel

curl http://127.0.0.1:8000/artists/1/embeddings
```

Embedding compute requests are queued. The server owns one lazy CLAP model instance per model/device configuration and reuses it across queued jobs. Cancellation is cooperative: queued jobs are cancelled immediately, while running jobs stop between tracks.

Useful endpoints:

- `POST /artists`: create or update an artist using the package `Artist` metadata shape: `name`, `links`, `images`, `soundcloud_url`, `instagram`, `youtube`, and `web`.
- `POST /artists/{artist_id}/download`: discover/download tracks and store chunk sample metadata.
- `GET /artists/{artist_id}/tracks`: list stored tracks, paths, sample counts, and embedding status.
- `POST /embeddings/compute`: enqueue missing per-track embeddings across all artists, or pass `artist_id`.
- `GET /embedding-jobs`: list queued/running/completed/failed/cancelled embedding jobs.
- `GET /embedding-jobs/{job_id}`: inspect one embedding job.
- `POST /embedding-jobs/{job_id}/cancel`: cancel a queued job or request cancellation of a running job.
- `GET /tracks/{track_id}/embedding`: retrieve one stored track embedding.
- `GET /artists/{artist_id}/embeddings`: retrieve per-track embeddings plus the per-artist average embedding.

## Code Layout

- `src/streetparade_embeddings/audio.py`: audio loading, resampling, chunking, normalization.
- `src/streetparade_embeddings/soundcloud.py`: HTML parsing, SoundCloud track discovery, cache paths, downloads.
- `src/streetparade_embeddings/youtube.py`: YouTube metadata extraction, MP3 downloads, and cache paths.
- `src/streetparade_embeddings/embeddings.py`: lazy CLAP model wrapper and embedding aggregation.
- `src/streetparade_embeddings/pipeline.py`: orchestration for download and embedding runs.
- `src/streetparade_embeddings/cli.py`: command-line interface.
- `src/streetparade_embeddings/api.py`: FastAPI and SQLite metadata server.

The notebooks are retained as exploration artifacts. New analysis should import package modules instead of redefining pipeline logic in notebook cells.

## Documentation

Build the Sphinx documentation locally:

```bash
pip install -e '.[docs]'
sphinx-build -b html docs docs/_build/html
```

The generated HTML entry point is `docs/_build/html/index.html`.
