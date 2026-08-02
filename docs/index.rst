Street Parade Embeddings
========================

Reusable tools for downloading SoundCloud and YouTube audio, computing CLAP embeddings, storing vectors in SQLite/ChromaDB, and exploring Street Parade artists and tracks through API-backed visualizations.

The package supports three common workflows:

* Python-library workflows from an ``artist_links.json`` file.
* API/admin workflows for queued downloads, embedding jobs, and vector search.
* Backend-backed visualizer workflows with user-submitted tracks, recomputed layouts, similarity links, and share tokens.

.. toctree::
   :maxdepth: 2
   :caption: User Guide

   installation
   usage
   research_workflow
   visualizer
   data_model
   api

Quick Example
-------------

Download one public SoundCloud track and infer the artist automatically:

.. code-block:: python

   from streetparade_embeddings.config import PipelineConfig
   from streetparade_embeddings.pipeline import download_single_track

   config = PipelineConfig(data_dir=".")
   result = download_single_track(
       config,
       "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul",
   )

Compute artist embeddings from cached downloads and ``artist_links.json``:

.. code-block:: python

   from streetparade_embeddings.pipeline import compute_artist_embeddings, save_embedding_results

   results = compute_artist_embeddings(config)
   save_embedding_results(results, config.resolved_output_dir)

Outputs are written to ``outputs/artist_embeddings.npz`` and ``outputs/artist_metadata.json`` by default.
