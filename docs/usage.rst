Usage Examples
==============

Download From ``artist_links.json``
-----------------------------------

Create or reuse a JSON file mapping artist names to SoundCloud track URLs:

.. code-block:: json

   {
     "Hilit Kolet": [
       "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul"
     ]
   }

Download up to three tracks per artist:

.. code-block:: bash

   streetparade-embeddings --data-dir . download --num-links 3

The downloader stores files in the deterministic cache layout:

.. code-block:: text

   .songs_cache/<artist_hash>/<track_hash>.mp3

Download One Track URL
----------------------

Pass a direct SoundCloud track URL. The artist is inferred from the track metadata:

.. code-block:: bash

   streetparade-embeddings --data-dir . download \
     --track-url "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul"

Override the artist cache bucket if needed:

.. code-block:: bash

   streetparade-embeddings --data-dir . download \
     --track-url "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul" \
     --artist "Hilit Kolet"

Discover Tracks From Saved Street Parade HTML
---------------------------------------------

When ``streetparade_data.html`` is available locally, discover track URLs for artists with SoundCloud pages:

.. code-block:: bash

   streetparade-embeddings --data-dir . discover-tracks

This writes ``artist_links.json`` under ``--data-dir`` unless ``--links-file`` points elsewhere.

Compute Embeddings
------------------

Compute artist-level embeddings from cached downloads:

.. code-block:: bash

   streetparade-embeddings --data-dir . --device auto embed

Use CPU explicitly:

.. code-block:: bash

   streetparade-embeddings --data-dir . --device cpu embed

Customize chunk and track limits:

.. code-block:: bash

   streetparade-embeddings --data-dir . \
     --max-tracks 5 \
     --max-chunks 12 \
     --chunk-seconds 30 \
     --chunk-stride-seconds 60 \
     embed

Run Download And Embedding Together
-----------------------------------

For an existing ``artist_links.json``:

.. code-block:: bash

   streetparade-embeddings --data-dir . --device auto run-all

Python API Example
------------------

.. code-block:: python

   from streetparade_embeddings.config import PipelineConfig
   from streetparade_embeddings.pipeline import download_single_track
   from pathlib import Path

   config = PipelineConfig(data_dir=Path("."))
   result = download_single_track(
       config,
       "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul",
   )

   print(result.artist)
   print(result.path)
