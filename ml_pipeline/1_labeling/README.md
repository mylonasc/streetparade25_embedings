# Music Segment Annotation

This folder contains the independent annotation system for labeling song segments.

The annotation app is decoupled from the main Street Parade API and frontends. It reads directly from a configurable SQLite database path, currently expected to be a `STREETPARADE_DB` database containing `tracks` and `track_samples` rows. The main API does not need to be running.

## Layout

- `backend/`: FastAPI annotation backend, repository helpers, and server script.
- `frontend/`: separate React labeler/configuration UI. This is not `fe-admin`.
- `docker-compose.yml`: standalone annotation stack.

## Concepts

- `annotation_campaign`: top-level annotation project.
- Label sets: groups such as `genre`, `mood`, or `energy` scoped to one `annotation_campaign`.
- Labels: values inside a label set.
- Campaign items: track segment rows included in an `annotation_campaign`.
- Assignments: multi-label annotations for a segment. The backend allows multiple labels on the same segment.

The labeler UI only needs segment metadata: `track_id`, `sound_segment_id`, `start_time`, and `end_time`. It does not load embeddings.

## Run Locally

Backend only:

```bash
cd ml_pipeline/1_labeling/backend
STREETPARADE_DB=../../data/streetparade_embeddings.sqlite3 python scripts/run_annotation_api.py
```

Frontend only:

```bash
cd ml_pipeline/1_labeling/frontend
npm install
VITE_ANNOTATION_API_BASE_URL=http://localhost:8100 npm run dev
```

Standalone Docker stack:

```bash
cd ml_pipeline/1_labeling
docker compose up --build
```

Services:

- Annotation API: `http://localhost:8100`
- Annotation UI: `http://localhost:3100`

## Configuring The Database

The frontend has a database configuration panel. It calls the annotation backend endpoint:

```text
POST /config/database
```

with:

```json
{"path":"/path/to/streetparade_embeddings.sqlite3"}
```

This switches the annotation backend facade to the selected SQLite file and initializes annotation tables in that database if needed.

## API Surface

- `GET /config/database`
- `POST /config/database`
- `POST /annotation_campaign`
- `GET /annotation_campaign`
- `GET /annotation_campaign/{campaign_id}`
- `POST /annotation_campaign/{campaign_id}/label-sets`
- `GET /annotation_campaign/{campaign_id}/label-sets`
- `POST /label-sets/{label_set_id}/labels`
- `GET /label-sets/{label_set_id}/labels`
- `POST /annotation_campaign/{campaign_id}/items`
- `DELETE /annotation_campaign/{campaign_id}/items/{item_id}`
- `GET /annotation_campaign/{campaign_id}/samples`
- `POST /annotation_campaign/{campaign_id}/assignments`
- `GET /annotation_campaign/{campaign_id}/assignments`
- `DELETE /assignments/{assignment_id}`
- `GET /tracks`
- `GET /tracks/{track_id}/samples`
- `GET /tracks/{track_id}/audio`

## Segment Embeddings

The shared embedding pipeline now supports optional segment-level embeddings while preserving existing track-level embeddings. Set `compute_segment_embeddings=true` on the existing embedding compute request to also populate `sample_embeddings`. The annotation UI does not require these vectors.
