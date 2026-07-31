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

## Python Usage

Discover track URLs from a SoundCloud artist page:

```python
from streetparade_embeddings.soundcloud import DiscoveryMethod, SoundCloudTrackDiscoverer

discoverer = SoundCloudTrackDiscoverer(method=DiscoveryMethod.YT_DLP)
track_urls = discoverer.discover("https://soundcloud.com/hilitkolet")
```

Download a single SoundCloud track URL directly:

```python
from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.pipeline import download_single_track

config = PipelineConfig(data_dir=".")
download = download_single_track(config, "https://soundcloud.com/artist/track", artist="Artist Name")
print(download.path)
```

If `artist` is omitted, the downloader resolves the track page and uses the SoundCloud artist metadata.

Download a YouTube video as MP3:

```python
from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.pipeline import download_youtube_track

config = PipelineConfig(data_dir=".")
download = download_youtube_track(config, "https://www.youtube.com/watch?v=1Hx3PGeADmc")
print(download.path)
```

Compute artist embeddings from downloaded tracks in Python:

```python
from streetparade_embeddings.config import PipelineConfig
from streetparade_embeddings.pipeline import compute_artist_embeddings, save_embedding_results

config = PipelineConfig(data_dir=".", device="auto")
results = compute_artist_embeddings(config)
save_embedding_results(results, config.resolved_output_dir)
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
  -d '{"name":"Hilit Kolet","links":["https://soundcloud.com/hilitkolet"],"images":[],"info":[],"bio":null,"soundcloud_url":"https://soundcloud.com/hilitkolet","instagram":null,"youtube":null,"web":null}'

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

Embedding compute requests are queued. The server owns one lazy CLAP model instance per model/device/configuration and reuses it across queued jobs. Vectors are stored in local ChromaDB storage, while SQLite stores track, artist, sampling, model, and vector-id metadata. Set `STREETPARADE_CHROMA_DIR` to choose the Chroma persistence directory; it defaults to `./chroma`. Cancellation is cooperative: queued jobs are cancelled immediately, while running jobs stop between tracks.

Useful endpoints:

- `POST /artists`: create or update an artist with `name`, `links`, `images`, `info`, `bio`, `soundcloud_url`, `instagram`, `youtube`, and `web`.
- `POST /artists/{artist_id}/download`: enqueue SoundCloud discovery/download work and return a download job immediately.
- `GET /download-jobs`: list queued/running/completed/failed/cancelled download jobs.
- `GET /download-jobs/{job_id}`: inspect one download job.
- `POST /download-jobs/{job_id}/cancel`: cancel a queued download job or request cancellation after the current track finishes.
- `GET /tracks`: list all tracks with `page` and `page_size` pagination. The default `page_size` is `100`.
- `GET /artists/{artist_id}/tracks`: list stored tracks, paths, sample counts, and embedding status.
- `POST /embeddings/compute`: enqueue missing per-track embeddings across all artists, or pass `artist_id`.
- `GET /embedding-jobs`: list queued/running/completed/failed/cancelled embedding jobs.
- `GET /embedding-jobs/{job_id}`: inspect one embedding job.
- `POST /embedding-jobs/{job_id}/cancel`: cancel a queued job or request cancellation of a running job.
- `GET /tracks/{track_id}/embedding`: retrieve one stored track embedding.
- `GET /tracks/{track_id}/embeddings`: list vector-store-backed embeddings and their sampling/model metadata for one track.
- `GET /artists/{artist_id}/embeddings`: retrieve per-track embeddings plus the per-artist average embedding.
- `POST /similarity/track-embeddings`: find similar track embeddings from a raw vector, vector IDs, or track IDs.

## Admin UI And Docker

Start the API and React admin UI with persistence on the host disk:

```bash
docker compose up --build
```

Services:

- API: `http://localhost:8000`
- Admin UI: `http://localhost:3000`
- Personal visualizer UI: `http://localhost:3001`

Persistent host folders used by `docker-compose.yml`:

- `./data`: SQLite database at `./data/streetparade_embeddings.sqlite3`.
- `./chroma`: Chroma vector store used by embedding search and visualizations.
- `./streetparade_embeddings.sqlite3`: seed metadata DB for the precomputed Street Parade embeddings. On API startup, Docker seeds `./data/streetparade_embeddings.sqlite3` from this file if the data DB has no embedding rows.
- `./.songs_cache`: downloaded SoundCloud MP3s.
- `./hf-cache`: Hugging Face model cache for CLAP downloads.

For local frontend development against a locally running API:

```bash
cd fe-admin
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

The admin UI supports adding/updating artists, listing artists, queueing downloads for one artist, queueing per-artist or global embedding jobs, cancelling jobs, viewing tracks, and retrieving artist-level average embedding metadata. Download jobs are non-blocking; track rows appear with `download_status` values such as `downloading`, `completed`, and `failed` while the UI polls the API.

For local development of the personal visualizer UI:

```bash
cd fe-visualizer
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

The personal visualizer is separate from `fe-admin`. It lets a public username submit SoundCloud or YouTube links, polls backend analysis jobs, shows that username's user-added songs on the embedding map, queues async t-SNE recomputes, and creates share links containing marked preferences plus submitted songs. SoundCloud links play through the embedded SoundCloud player by default; YouTube submissions play from the local cached audio after backend download/analysis completes.

## Batch Indexing Artists 2026

Index SoundCloud tracks from `artists_2026.yaml` without using `yt-dlp` for SoundCloud downloads:

```bash
uv run python scripts/index_artists_2026.py --max-tracks-per-artist 5
```

Use `--max-tracks-per-artist 0` to process all discovered tracks for each artist. Discovery and downloads use direct SoundCloud HTTP API calls, not `yt-dlp`, and embeddings are stored in ChromaDB with metadata in SQLite.

## Embedding Visualization

Generate a static D3.js t-SNE scatterplot from the stored embeddings:

```bash
uv run python scripts/build_embedding_visualization.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out outputs/embedding_visualization \
  --playback local \
  --start-fraction 0.5
```

Generate a SoundCloud-player version instead:

```bash
uv run python scripts/build_embedding_visualization.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out site \
  --playback soundcloud \
  --audio-assets none \
  --start-fraction 0.5
```

The script reads the latest track vectors from ChromaDB, computes artist-average points, projects all points to 2D with t-SNE, clusters the original full-dimensional vectors with spectral clustering, and writes `index.html`, `app.js`, `styles.css`, and `data.json`. Local playback exposes cached songs under `audio/`, while SoundCloud playback uses canonical `w.soundcloud.com/player` embed URLs derived from the stored track URLs. Serve the site with the range-aware helper so browser audio seeking works reliably:

```bash
uv run python scripts/serve_embedding_visualization.py --directory outputs/embedding_visualization --port 8080
```

Useful options include `--clusters N`, `--perplexity N`, `--tracks-only`, `--model MODEL_NAME`, `--playback local|soundcloud`, `--start-fraction 0.5`, `--start-seconds N`, and `--audio-assets symlink|copy|none`. Artist marks are saved in browser `localStorage`. Local playback uses cached files from disk, while SoundCloud playback auto-loads an embedded SoundCloud player for stored SoundCloud URLs.

## GitHub Pages

The repository includes `.github/workflows/deploy-embedding-visualization.yml`, which rebuilds the static visualization into `site/` on every push to `main` and deploys it with GitHub Pages.

Before enabling the workflow, make sure the repository also contains the Chroma persistence directory expected by the build command:

```bash
python scripts/build_embedding_visualization.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out site \
  --playback soundcloud \
  --audio-assets none
```

Then enable GitHub Pages in the repository settings with `Build and deployment` set to `GitHub Actions`.

## Code Layout

- `src/streetparade_embeddings/audio.py`: audio loading, resampling, chunking, normalization.
- `src/streetparade_embeddings/soundcloud.py`: HTML parsing, SoundCloud track discovery, cache paths, downloads.
- `src/streetparade_embeddings/youtube.py`: YouTube metadata extraction, MP3 downloads, and cache paths.
- `src/streetparade_embeddings/embeddings.py`: lazy CLAP model wrapper and embedding aggregation.
- `src/streetparade_embeddings/pipeline.py`: orchestration for download and embedding runs.
- `src/streetparade_embeddings/api.py`: FastAPI and SQLite metadata server.
- `fe-admin/`: React admin UI for operating the API.
- `docker-compose.yml`: API and frontend deployment with host-mounted persistence.

The notebooks are retained as exploration artifacts. New analysis should import package modules instead of redefining pipeline logic in notebook cells.

## Documentation

Build the Sphinx documentation locally:

```bash
pip install -e '.[docs]'
sphinx-build -b html docs docs/_build/html
```

The generated HTML entry point is `docs/_build/html/index.html`.
