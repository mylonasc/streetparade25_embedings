Data Model
==========

The application stores operational metadata in SQLite and embedding vectors in a local ChromaDB collection. SQLite records integer primary keys, stable UUIDs for artists/tracks/embedding rows, artist/track relationships, sampling strategy metadata, embedding model configuration, and the Chroma ``vector_id`` for each stored vector.

The ``tracks.embedding`` column is retained only for legacy compatibility. New embedding writes store vectors in ChromaDB and store metadata/provenance in ``track_embeddings``. A track can have multiple embedding rows when the backend, model configuration, or sampling strategy changes.

.. uml:: data_model.puml
   :caption: Street Parade embeddings data model

Rendering Notes
---------------

The diagram source is kept in ``docs/data_model.puml``. Sphinx renders it through ``sphinxcontrib-plantuml`` using ``PLANTUML_COMMAND``, a system ``plantuml`` executable, or an automatically cached PlantUML JAR when Java is available.
