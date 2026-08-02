# Street Parade Embeddings

Pipeline, API, admin UI, and embedding-map visualizer for collecting Street Parade artist tracks, computing CLAP embeddings, storing them in SQLite/ChromaDB, and exploring the resulting musical space.

The repository supports three main workflows:

- Python research workflow for SoundCloud/YouTube downloads and CLAP embedding computation.
- FastAPI backend with queued download, embedding, user-track, layout, and sharing jobs.
- React frontends for administration and a public/personal embedding visualizer.

## Install

```bash
pip install -e .
```

For tests and local development:

```bash
pip install -e '.[dev]'
```

For documentation builds:

```bash
pip install -e '.[docs]'
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

Set `STREETPARADE_CHROMA_DIR` to choose the ChromaDB persistence directory. It defaults to `./chroma`.

Embedding compute requests are queued. The server owns one lazy CLAP model instance per model/device/configuration and reuses it across queued jobs. Vectors are stored in local ChromaDB storage, while SQLite stores track, artist, sampling, model, job, user-track, layout, and share metadata. Cancellation is cooperative: queued jobs are cancelled immediately, while running jobs stop between tracks.

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

curl http://127.0.0.1:8000/artists/1/embeddings
```

Useful pipeline endpoints:

- `GET /health`: check API availability.
- `POST /artists`: create or update an artist with profile links, images, info, bio, and social URLs.
- `GET /artists`: list artists.
- `GET /artists/{artist_id}`: retrieve one artist.
- `POST /artists/{artist_id}/download`: enqueue SoundCloud discovery/download work and return immediately.
- `GET /download-jobs`: list queued, running, completed, failed, and cancelled download jobs.
- `GET /download-jobs/{job_id}`: inspect one download job.
- `POST /download-jobs/{job_id}/cancel`: cancel a queued download job or request cancellation after the current track finishes.
- `GET /tracks`: list all tracks with `page` and `page_size` pagination.
- `GET /artists/{artist_id}/tracks`: list stored tracks, paths, sample counts, and embedding status for one artist.
- `GET /tracks/{track_id}/samples`: list generated audio samples/chunks for one track.
- `GET /tracks/{track_id}/embeddings`: list vector-store-backed embeddings and their sampling/model metadata for one track.
- `POST /embeddings/compute`: enqueue missing per-track embeddings across all artists, or pass `artist_id`.
- `POST /artists/{artist_id}/embeddings/compute`: enqueue embedding computation for one artist.
- `GET /embedding-jobs`: list queued, running, completed, failed, and cancelled embedding jobs.
- `GET /embedding-jobs/{job_id}`: inspect one embedding job.
- `POST /embedding-jobs/{job_id}/cancel`: cancel a queued job or request cancellation of a running job.
- `GET /tracks/{track_id}/embedding`: retrieve one stored track embedding.
- `GET /artists/{artist_id}/embeddings`: retrieve per-track embeddings plus the per-artist average embedding.
- `POST /similarity/track-embeddings`: find similar track embeddings from a raw vector, vector IDs, or track IDs.

Useful visualizer/user endpoints:

- `POST /users`: create or retrieve a public username.
- `GET /users/{username}`: fetch one user profile.
- `POST /users/{username}/tracks`: submit a SoundCloud or YouTube URL for async download and analysis.
- `GET /users/{username}/tracks`: list a user's submitted tracks.
- `GET /users/{username}/tracks/{user_track_id}/audio`: stream cached audio for a completed user track.
- `GET /user-track-jobs/{job_id}`: inspect a user-track analysis job.
- `GET /visualization`: retrieve base artist/track/user-track map points.
- `POST /layouts/recompute`: queue PCA/t-SNE/clustering recomputation.
- `GET /layout-jobs/{job_id}`: inspect a layout recompute job.
- `POST /shares`: create a share token containing the username, marked preferences, and submitted songs.
- `GET /shares/{token}`: retrieve a shared visualizer state.

`POST /similarity/track-embeddings` accepts `metric: "cosine"` or `metric: "euclidean"`. Cosine search uses the vector store. Euclidean search compares against the latest raw track embeddings and returns similarity as `1 / (1 + distance)`.

`POST /layouts/recompute` accepts:

- `username`: optional user whose submitted tracks should be merged into the layout.
- `pca_enabled`: enable PCA preprocessing before t-SNE and/or clustering.
- `pca_components`: number of PCA dimensions when PCA is enabled.
- `tsne_input`: `raw` or `pca`.
- `cluster_input`: `raw` or `pca`.
- `cluster_count`: optional spectral clustering cluster count.
- `tsne_perplexity`: optional t-SNE perplexity.
- `tsne_learning_rate`: numeric value or `auto`.
- `tsne_metric`: `cosine`, `euclidean`, or `manhattan`.
- `random_state`: deterministic seed for reproducible recomputes.

## Docker Services

Start the API, admin UI, and default visualizer UI with persistence on the host disk:

```bash
docker compose up --build
```

Default services:

- API: `http://localhost:8000`
- Admin UI: `http://localhost:3000`
- Backend-backed visualizer UI: `http://localhost:3001`

Persistent host folders used by `docker-compose.yml`:

- `./data`: SQLite database at `./data/streetparade_embeddings.sqlite3`.
- `./chroma`: Chroma vector store used by embedding search and visualizations.
- `./.songs_cache`: downloaded SoundCloud and YouTube MP3s.
- `./hf-cache`: Hugging Face model cache for CLAP downloads.

## Continuous Integration

GitHub Actions CI is defined in `.github/workflows/ci.yml` and runs on pushes and pull requests.

Jobs are split by project area:

- `backend-tests`: installs Python dependencies and runs the fast backend test subset: `tests/test_audio.py`, `tests/test_pipeline.py`, and `tests/test_api_embedding_service.py`.
- `media-fixture-tests`: restores `.ci-media-cache` from GitHub Actions cache, downloads any missing files listed in `tests/fixtures/media_manifest.json`, and validates the cached MP3 fixtures.
- `frontend-admin`: runs `npm ci` and `npm run build` in `fe-admin`.
- `frontend-visualizer`: runs `npm ci`, the default visualizer build, and the `/streetparade26/` prefixed visualizer build in `fe-visualizer`.
- `docker-smoke`: validates both Compose files, builds the `/streetparade26/` visualizer image, checks nginx syntax, verifies `/` returns `404`, verifies `/streetparade26/` serves prefixed assets, and verifies `/streetparade26/api/*` proxies to an `api:8000` upstream with the prefix stripped.

Run the same backend checks locally with:

```bash
pytest tests/test_audio.py tests/test_pipeline.py tests/test_api_embedding_service.py
```

Run the media fixture cache workflow locally with:

```bash
python tests/fixtures/download_media_fixtures.py tests/fixtures/media_manifest.json .ci-media-cache
MEDIA_FIXTURE_CACHE=.ci-media-cache pytest tests/test_media_fixtures.py
```

The media fixture job only downloads when the manifest changes or the cache is missing. The downloaded MP3s are not committed to the repository. Keep `tests/fixtures/media_manifest.json` small and use stable public links. The direct live-download test file remains available for explicit local checks with `RUN_LIVE_DOWNLOAD_TESTS=1 pytest tests/test_download_links.py`.

## `/streetparade26/` Deployment

The repository includes a separate Docker Compose setup for serving the visualizer behind nginx under the `/streetparade26/` path:

```bash
docker compose -f docker-compose.streetparade26.yml up --build -d
```

Open:

```text
http://localhost:8080/streetparade26/
```

This setup builds `fe-visualizer` with `VITE_BASE_PATH=/streetparade26/` and `VITE_API_BASE_URL=/streetparade26/api`. nginx serves only the defined path, redirects `/streetparade26` to `/streetparade26/`, proxies `/streetparade26/api/*` to the backend API container, and returns `404` for `/` and other undefined paths. The config lives in `fe-visualizer/nginx.streetparade26.conf` and the image definition lives in `fe-visualizer/Dockerfile.streetparade26`.

## Frontend Development

For local admin UI development against a locally running API:

```bash
cd fe-admin
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

The admin UI supports adding/updating artists, listing artists, queueing downloads for one artist, queueing per-artist or global embedding jobs, cancelling jobs, viewing tracks, and retrieving artist-level average embedding metadata. Download jobs are non-blocking; track rows appear with `download_status` values such as `downloading`, `completed`, and `failed` while the UI polls the API.

For local development of the backend-backed visualizer UI:

```bash
cd fe-visualizer
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

To build the visualizer for a path prefix:

```bash
cd fe-visualizer
VITE_BASE_PATH=/streetparade26/ VITE_API_BASE_URL=/streetparade26/api npm run build
```

## Backend-Backed Visualizer Features

The personal visualizer is separate from `fe-admin`. It lets a public username submit SoundCloud or YouTube links, polls backend analysis jobs, shows that username's user-added songs on the embedding map, queues async PCA/t-SNE/clustering recomputes, and creates share links containing marked preferences plus submitted songs.

Current interaction features include:

- Canvas-based D3 zoom/pan rendering with quadtree hit testing for larger point sets.
- Search across artists, tracks, URLs, and flat metadata.
- Artist and song visibility toggles.
- Cluster dropdown and per-selection cluster highlighting.
- Selection history with Undo/Redo controls and `Ctrl+Z` / `Ctrl+R` keyboard shortcuts.
- Marking preference points with a star and sharing marked state through share links.
- Selected-track similarity links from `/similarity/track-embeddings`.
- Configurable neighbor count, similarity threshold, and cosine/euclidean metric for graph links.
- Artist selections link to that artist's tracks.
- Hover tooltips for points and similarity edges.
- Tooltip actions to play the first similar song or jump to a random other song.
- Help modal explaining navigation, selections, embeddings, PCA, t-SNE, and clustering.
- Mobile/coarse-pointer styling that reduces expensive visual effects.

Playback behavior:

- SoundCloud links play through the embedded SoundCloud player when possible.
- YouTube submissions and downloaded user tracks play from cached backend audio after analysis completes.
- Resetting selection clears focus without stopping active playback.

## Batch Indexing Artists 2026

Index SoundCloud tracks from `artists_2026.yaml` without using `yt-dlp` for SoundCloud downloads:

```bash
uv run python scripts/index_artists_2026.py --max-tracks-per-artist 5
```

Use `--max-tracks-per-artist 0` to process all discovered tracks for each artist. Discovery and downloads use direct SoundCloud HTTP API calls, not `yt-dlp`, and embeddings are stored in ChromaDB with metadata in SQLite.

## Static Embedding Visualization

Create the compact static-data snapshot used by GitHub Pages:

```bash
uv run python scripts/create_static_data_snapshot.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out scripts/.data_cache/static_data_snapshot.json
```

Generate a static D3.js t-SNE scatterplot from the snapshot:

```bash
uv run python scripts/build_embedding_visualization.py \
  --snapshot scripts/.data_cache/static_data_snapshot.json \
  --out outputs/embedding_visualization \
  --playback local \
  --start-fraction 0.5
```

Generate a SoundCloud-player version instead:

```bash
uv run python scripts/build_embedding_visualization.py \
  --snapshot scripts/.data_cache/static_data_snapshot.json \
  --out site \
  --playback soundcloud \
  --audio-assets none \
  --start-fraction 0.5
```

The snapshot script reads the latest track vectors from ChromaDB and the required artist/track metadata from SQLite, then writes `scripts/.data_cache/static_data_snapshot.json`. The visualization script reads that snapshot, computes artist-average points, projects all points to 2D with t-SNE, clusters the original full-dimensional vectors with spectral clustering, and writes `index.html`, `app.js`, `styles.css`, and `data.json`. Live `chroma/` and `*.sqlite3` files are runtime artifacts and should not be committed.

Serve the site with the range-aware helper so browser audio seeking works reliably:

```bash
uv run python scripts/serve_embedding_visualization.py --directory outputs/embedding_visualization --port 8080
```

Useful options include `--clusters N`, `--perplexity N`, `--tracks-only`, `--model MODEL_NAME`, `--playback local|soundcloud`, `--start-fraction 0.5`, `--start-seconds N`, and `--audio-assets symlink|copy|none`. Artist marks are saved in browser `localStorage`. Local playback uses cached files from disk, while SoundCloud playback auto-loads an embedded SoundCloud player for stored SoundCloud URLs.

## GitHub Pages

The repository includes `.github/workflows/deploy-embedding-visualization.yml`, which rebuilds the static visualization into `site/` on every push to `main` and deploys it with GitHub Pages.

Before enabling the workflow, make sure the repository contains an up-to-date static snapshot:

```bash
python scripts/create_static_data_snapshot.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out scripts/.data_cache/static_data_snapshot.json
```

Then enable GitHub Pages in the repository settings with `Build and deployment` set to `GitHub Actions`.

## Code Layout

- `src/streetparade_embeddings/audio.py`: audio loading, resampling, chunking, normalization.
- `src/streetparade_embeddings/soundcloud.py`: SoundCloud track discovery, cache paths, and downloads.
- `src/streetparade_embeddings/youtube.py`: YouTube metadata extraction, MP3 downloads, and cache paths.
- `src/streetparade_embeddings/embeddings.py`: lazy CLAP model wrapper and embedding aggregation.
- `src/streetparade_embeddings/pipeline.py`: Python orchestration for download and embedding runs.
- `src/streetparade_embeddings/api.py`: FastAPI app, job queues, user-track workflow, visualization endpoints, and share endpoints.
- `src/streetparade_embeddings/repositories.py`: SQLite/ChromaDB repository helpers and similarity search.
- `src/streetparade_embeddings/user_visualization.py`: visualizer point assembly, layout recomputation, PCA/t-SNE projection, clustering, and user-track merge logic.
- `src/streetparade_embeddings/schemas.py`: Pydantic request schemas and in-memory job dataclasses.
- `fe-admin/`: React admin UI for operating the API.
- `fe-visualizer/`: React backend-backed personal visualizer UI.
- `scripts/`: indexing, snapshot, static visualization, and helper scripts.
- `docker-compose.yml`: default API/admin/visualizer development deployment.
- `docker-compose.streetparade26.yml`: path-prefixed nginx deployment for `/streetparade26/`.
- `ml_pipeline/1_labeling/`: independent music segment annotation system with its own backend, frontend, Docker compose, and README.
- `ml_pipeline/2_train/`: notebook workflow for training multi-label classifiers on labeled CLAP segment embeddings.

The notebooks are retained as exploration artifacts. New analysis should import package modules instead of redefining pipeline logic in notebook cells.

## Documentation

Build the Sphinx documentation locally:

```bash
pip install -e '.[docs]'
sphinx-build -b html docs docs/_build/html
```

The generated HTML entry point is `docs/_build/html/index.html`.
