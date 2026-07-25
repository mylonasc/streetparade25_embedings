Command-Line Interface
======================

Global Options
--------------

``streetparade-embeddings`` accepts shared options before the subcommand:

.. code-block:: bash

   streetparade-embeddings [OPTIONS] COMMAND

Important options:

* ``--data-dir``: base directory for data files, cache, and outputs.
* ``--cache-dir``: explicit MP3 cache directory. Defaults to ``<data-dir>/.songs_cache``.
* ``--links-file``: artist-to-track JSON path. Defaults to ``artist_links.json`` under ``--data-dir``.
* ``--html-file``: saved Street Parade HTML path. Defaults to ``streetparade_data.html`` under ``--data-dir``.
* ``--output-dir``: embedding output directory. Defaults to ``outputs`` under ``--data-dir``.
* ``--device``: ``auto``, ``cpu``, or ``cuda`` for CLAP inference.
* ``--max-tracks``: maximum downloaded/cached tracks to aggregate per artist.
* ``--max-chunks``: maximum audio chunks per track.

``parse-artists``
-----------------

Parse the saved Street Parade HTML and write artist SoundCloud page URLs to ``artist_links.json``:

.. code-block:: bash

   streetparade-embeddings --data-dir . parse-artists

``discover-tracks``
-------------------

Render discovered SoundCloud artist pages and write track URLs to ``artist_links.json``:

.. code-block:: bash

   streetparade-embeddings --data-dir . discover-tracks

This command requires the optional ``discovery`` dependencies.

``download``
------------

Download from ``artist_links.json``:

.. code-block:: bash

   streetparade-embeddings --data-dir . download --num-links 3

Download one direct track URL:

.. code-block:: bash

   streetparade-embeddings --data-dir . download \
     --track-url "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul"

``youtube-download``
--------------------

Download one YouTube video as a cached MP3:

.. code-block:: bash

   streetparade-embeddings --data-dir . youtube-download \
     --url "https://www.youtube.com/watch?v=1Hx3PGeADmc"

The file is stored under ``.songs_cache/youtube/<artist_hash>/<url_hash>.mp3``.

The same downloader can be invoked as a focused module:

.. code-block:: bash

   python -m streetparade_embeddings.youtube \
     "https://www.youtube.com/watch?v=1Hx3PGeADmc"

``embed``
---------

Compute artist embeddings from downloaded tracks:

.. code-block:: bash

   streetparade-embeddings --data-dir . --device auto embed

``run-all``
-----------

Download tracks from ``artist_links.json`` and then compute embeddings:

.. code-block:: bash

   streetparade-embeddings --data-dir . --device auto run-all
