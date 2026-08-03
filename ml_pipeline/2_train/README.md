# Segment Label Training

This folder contains training workflows for models built on top of CLAP segment embeddings and labels produced by `ml_pipeline/1_labeling`.

The first workflow is a notebook:

- `train_clap_segment_labels.ipynb`: reads labeled segment assignments from SQLite, loads matching `sample_embeddings` vectors from Chroma, creates multi-label targets, performs a stratified train/validation/test split, and trains a small TensorFlow/Keras MLP.
- `compute_set_training_embedings.py`: computes missing CLAP segment embeddings for the segments in an `annotation_campaign` and stores them in SQLite `sample_embeddings` plus Chroma.

## Inputs

- `STREETPARADE_DB`: SQLite database containing annotation tables and `sample_embeddings`.
- `STREETPARADE_CHROMA_DIR`: Chroma directory containing vectors for `sample_embeddings.vector_id`.
- `ANNOTATION_CAMPAIGN_ID`: the `annotation_campaign.id` to train on.

The notebook expects segment embeddings to already exist. They can be computed through the existing embedding pipeline by setting `compute_segment_embeddings=true`.

To compute only the segment embeddings required by one annotation campaign:

```bash
uv run python ml_pipeline/2_train/compute_set_training_embedings.py \
  --campaign-id 1 \
  --db data/streetparade_embeddings.sqlite3 \
  --chroma-dir chroma \
  --device auto
```

If the DB stores host paths and audio is mounted elsewhere, add one or more cache roots:

```bash
uv run python ml_pipeline/2_train/compute_set_training_embedings.py \
  --campaign-id 1 \
  --audio-root .songs_cache
```

If the script reports `attempt to write a readonly database`, the SQLite file or its directory is not writable by the current user/container. The script must write rows to `sample_embeddings`, and SQLite may also need to write `-wal` and `-shm` files next to the DB.

Common local fix:

```bash
sudo chown $USER:$USER data/streetparade_embeddings.sqlite3 data/streetparade_embeddings.sqlite3-wal data/streetparade_embeddings.sqlite3-shm
chmod u+w data/streetparade_embeddings.sqlite3 data/streetparade_embeddings.sqlite3-wal data/streetparade_embeddings.sqlite3-shm
sudo chown $USER:$USER data
chmod u+w data
```

Alternatively, train on a writable copy:

```bash
cp data/streetparade_embeddings.sqlite3 /tmp/streetparade_training.sqlite3
uv run python ml_pipeline/2_train/compute_set_training_embedings.py --db /tmp/streetparade_training.sqlite3 --campaign-id 1
```

## Notes

- This folder does not add annotation features.
- The initial model is multi-label, so it uses sigmoid outputs and binary cross-entropy.
- The stratification strategy groups samples by their exact label signature when possible, with a deterministic random fallback for sparse label combinations.
