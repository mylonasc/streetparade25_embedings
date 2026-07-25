Street Parade Embeddings
========================

Reusable tools for downloading SoundCloud audio and computing artist-level CLAP embeddings for research analysis.

The package supports two common workflows:

* Batch processing from an ``artist_links.json`` file.
* Direct downloads from a single SoundCloud track URL, with artist metadata inferred from the track page.

.. toctree::
   :maxdepth: 2
   :caption: User Guide

   installation
   usage
   cli
   research_workflow
   api

Quick Example
-------------

Download one public SoundCloud track and infer the artist automatically:

.. code-block:: bash

   streetparade-embeddings --data-dir . download \
     --track-url "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul"

Compute artist embeddings from cached downloads and ``artist_links.json``:

.. code-block:: bash

   streetparade-embeddings --data-dir . --device auto embed

Outputs are written to ``outputs/artist_embeddings.npz`` and ``outputs/artist_metadata.json`` by default.
