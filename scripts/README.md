# Scripts

## GitHub Pages Data Flow

The GitHub Pages site is generated during the deployment workflow. The repository does not need to commit `site/` or `scripts/.data_cache/static_data_snapshot.json`.

The workflow in `.github/workflows/deploy-embedding-visualization.yml` does this on every push to `main`:

1. Downloads the release asset `streetparade-pages-data.tar.gz` from the GitHub release tag `embedding-visualization-data-v1`.
2. Extracts `streetparade_embeddings.sqlite3` and `chroma/` into the workflow workspace.
3. Runs `scripts/create_static_data_snapshot.py` and writes the snapshot to `/tmp/streetparade-static-data-snapshot.json`.
4. Runs `scripts/build_embedding_visualization.py` with that temporary snapshot and writes the generated site to `site/`.
5. Uploads `site/` as the GitHub Pages artifact and deploys it.

This keeps generated files out of `main`. The committed source of truth is the Python scripts plus the versioned release data artifact.

## Release Data Artifact

The Pages build needs two runtime data inputs:

- `streetparade_embeddings.sqlite3`: metadata database.
- `chroma/`: persisted ChromaDB vectors.

Package them from the repository root with:

```bash
tar -czf /tmp/streetparade-pages-data.tar.gz streetparade_embeddings.sqlite3 chroma
```

Create the first release with:

```bash
gh release create embedding-visualization-data-v1 \
  /tmp/streetparade-pages-data.tar.gz \
  --title "Embedding visualization data v1" \
  --notes "SQLite metadata and Chroma vectors used to build the GitHub Pages embedding visualization."
```

Replace the asset for the same data version with:

```bash
gh release upload embedding-visualization-data-v1 \
  /tmp/streetparade-pages-data.tar.gz \
  --clobber
```

For a new immutable data version, create a new release tag and update `DATA_RELEASE_TAG` in `.github/workflows/deploy-embedding-visualization.yml`.

## Local Snapshot And Site Build

To reproduce the GitHub Pages build locally from unpacked data:

```bash
uv run python scripts/create_static_data_snapshot.py \
  --db streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --out /tmp/streetparade-static-data-snapshot.json
```

```bash
uv run python scripts/build_embedding_visualization.py \
  --snapshot /tmp/streetparade-static-data-snapshot.json \
  --out site \
  --playback soundcloud \
  --audio-assets none \
  --start-fraction 0.5
```

`site/` and `scripts/.data_cache/*.json` are ignored because they are generated outputs.
