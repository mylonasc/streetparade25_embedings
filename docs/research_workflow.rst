Research Workflow
=================

Recommended Directory Layout
----------------------------

Keep raw, intermediate, and generated files separate:

.. code-block:: text

   project/
     streetparade_data.html
     artist_links.json
     .songs_cache/
     outputs/
       artist_embeddings.npz
       artist_metadata.json

Pipeline Stages
---------------

1. Collect artist sources.
   Save the Street Parade artist listing HTML as ``streetparade_data.html`` or prepare ``artist_links.json`` manually.

2. Discover SoundCloud track URLs.
   Use :class:`streetparade_embeddings.soundcloud.SoundCloudTrackDiscoverer` with ``DiscoveryMethod.YT_DLP`` when starting from artist pages, use ``DiscoveryMethod.REQUESTS_HTML`` for the legacy browser-rendered backend, or edit ``artist_links.json`` directly.

3. Download audio.
   Downloads are cached by stable hashes of artist name and track URL, so reruns skip existing files.

4. Preprocess audio.
   MP3s are resampled to mono audio at the configured sampling rate, split into fixed chunks, and normalized to floats.

5. Embed tracks.
   CLAP audio features are computed per chunk and averaged to one track embedding.

6. Aggregate artists.
   Track embeddings are averaged into one artist-level embedding.

Outputs
-------

``artist_embeddings.npz`` contains:

* ``embeddings``: a two-dimensional array of artist embeddings.
* ``artists``: artist names aligned with the embedding rows.

``artist_metadata.json`` contains per-artist status, cached track paths, and any processing errors.

Reproducibility Notes
---------------------

* Keep ``artist_links.json`` under version control if the set of downloaded tracks matters for analysis.
* Keep ``.songs_cache`` out of version control; it contains downloaded media.
* Record the model name and pipeline configuration used for any analysis result.
* Prefer ``Device.CPU`` for deterministic local debugging and ``Device.CUDA`` or ``Device.AUTO`` for larger runs.
