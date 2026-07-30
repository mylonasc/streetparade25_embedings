Usage Examples
==============

The project is a Python library and API server. It does not install command-line entry points.

Download From ``artist_links.json``
-----------------------------------

Create or reuse a JSON file mapping artist names to SoundCloud track URLs:

.. code-block:: json

   {
     "Hilit Kolet": [
       "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul"
     ]
   }

Download up to three tracks per artist from Python:

.. code-block:: python

   from streetparade_embeddings.config import PipelineConfig
   from streetparade_embeddings.pipeline import download_artist_tracks

   config = PipelineConfig(data_dir=".", links_file="artist_links.json", max_tracks=3)
   download_artist_tracks(config)

The downloader stores files in the deterministic cache layout:

.. code-block:: text

   .songs_cache/<artist_hash>/<track_hash>.mp3

Download One Track URL
----------------------

Pass a direct SoundCloud track URL. The artist is inferred from the track metadata:

.. code-block:: python

   from streetparade_embeddings.config import PipelineConfig
   from streetparade_embeddings.pipeline import download_single_track

   config = PipelineConfig(data_dir=".")
   result = download_single_track(
       config,
       "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul",
   )

Override the artist cache bucket if needed:

.. code-block:: python

   result = download_single_track(
       config,
       "https://soundcloud.com/hilitkolet/hilit-kolet-i-want-your-soul",
       artist="Hilit Kolet",
   )

Download One YouTube Video As MP3
---------------------------------

Pass a YouTube video URL. The channel or artist metadata is inferred with ``yt-dlp``:

.. code-block:: python

   from streetparade_embeddings.config import PipelineConfig
   from streetparade_embeddings.pipeline import download_youtube_track

   config = PipelineConfig(data_dir=".")
   result = download_youtube_track(
       config,
       "https://www.youtube.com/watch?v=1Hx3PGeADmc",
   )

The file is stored under ``.songs_cache/youtube/<artist_hash>/<url_hash>.mp3``.

Discover Tracks From Saved Street Parade HTML
---------------------------------------------

When ``streetparade_data.html`` is available locally, discover track URLs for artists with SoundCloud pages and write ``artist_links.json``:

.. code-block:: python

   from streetparade_embeddings.config import PipelineConfig
   from streetparade_embeddings.pipeline import write_soundcloud_artist_links
   from streetparade_embeddings.soundcloud import DiscoveryMethod

   config = PipelineConfig(data_dir=".", html_file="streetparade_data.html")
   artist_links = write_soundcloud_artist_links(config, discovery_method=DiscoveryMethod.YT_DLP)

Select A SoundCloud Discovery Backend
-------------------------------------

Instantiate a discoverer with the backend you want to use:

.. code-block:: python

   from streetparade_embeddings.soundcloud import DiscoveryMethod, SoundCloudTrackDiscoverer

   discoverer = SoundCloudTrackDiscoverer(method=DiscoveryMethod.YT_DLP)
   track_urls = discoverer.discover("https://soundcloud.com/hilitkolet")

The original rendered-page method is also selectable:

.. code-block:: python

   discoverer = SoundCloudTrackDiscoverer(method=DiscoveryMethod.REQUESTS_HTML)
   track_urls = discoverer.discover("https://soundcloud.com/hilitkolet")

Compute Embeddings
------------------

Compute artist-level embeddings from cached downloads:

.. code-block:: python

   from streetparade_embeddings.config import Device, PipelineConfig
   from streetparade_embeddings.pipeline import compute_artist_embeddings, save_embedding_results

   config = PipelineConfig(data_dir=".", device=Device.AUTO)
   results = compute_artist_embeddings(config)
   save_embedding_results(results, config.resolved_output_dir)

Customize chunk and track limits:

.. code-block:: python

   config = PipelineConfig(
       data_dir=".",
       device=Device.CPU,
       max_tracks=5,
       max_chunks=12,
       chunk_seconds=30,
       chunk_stride_seconds=60,
   )
   results = compute_artist_embeddings(config)

Run Download And Embedding Together
-----------------------------------

For an existing ``artist_links.json``:

.. code-block:: python

   config = PipelineConfig(data_dir=".", device=Device.AUTO)
   download_artist_tracks(config)
   results = compute_artist_embeddings(config)
   save_embedding_results(results, config.resolved_output_dir)
