API Reference
=============

The public API is organized by pipeline responsibility.

HTTP Endpoints
--------------

The FastAPI app in ``streetparade_embeddings.api`` exposes pipeline, visualization, and sharing endpoints.

Pipeline endpoints include:

* ``GET /health``
* ``POST /artists``
* ``GET /artists``
* ``GET /artists/{artist_id}``
* ``GET /artists/{artist_id}/tracks``
* ``GET /tracks``
* ``POST /artists/{artist_id}/download``
* ``GET /download-jobs``
* ``GET /download-jobs/{job_id}``
* ``POST /download-jobs/{job_id}/cancel``
* ``GET /tracks/{track_id}/samples``
* ``GET /tracks/{track_id}/embeddings``
* ``POST /similarity/track-embeddings``
* ``POST /embeddings/compute``
* ``POST /artists/{artist_id}/embeddings/compute``
* ``GET /embedding-jobs``
* ``GET /embedding-jobs/{job_id}``
* ``POST /embedding-jobs/{job_id}/cancel``
* ``GET /tracks/{track_id}/embedding``
* ``GET /artists/{artist_id}/embeddings``

Visualizer endpoints include:

* ``POST /users``
* ``GET /users/{username}``
* ``POST /users/{username}/tracks``
* ``GET /users/{username}/tracks``
* ``GET /users/{username}/preferences``
* ``POST /users/{username}/preferences``
* ``GET /users/{username}/tracks/{user_track_id}/audio``
* ``GET /user-track-jobs/{job_id}``
* ``GET /visualization``
* ``POST /layouts/recompute``
* ``GET /layout-jobs/{job_id}``
* ``POST /shares``
* ``GET /shares/{token}``

``POST /similarity/track-embeddings`` accepts cosine and euclidean metrics. ``POST /layouts/recompute`` accepts optional PCA, t-SNE, spectral clustering, and random-seed controls through :class:`streetparade_embeddings.schemas.LayoutRequest`.

FastAPI Application
-------------------

.. automodule:: streetparade_embeddings.api
   :members:
   :undoc-members:

.. automodule:: streetparade_embeddings.app_factory
   :members:
   :undoc-members:

.. automodule:: streetparade_embeddings.routes.catalog
   :members:
   :undoc-members:

.. automodule:: streetparade_embeddings.routes.jobs
   :members:
   :undoc-members:

.. automodule:: streetparade_embeddings.routes.users
   :members:
   :undoc-members:

.. automodule:: streetparade_embeddings.jobs
   :members:
   :undoc-members:

.. automodule:: streetparade_embeddings.runtime
   :members:
   :undoc-members:

Configuration
-------------

.. automodule:: streetparade_embeddings.config
   :members:
   :undoc-members:

Use :class:`streetparade_embeddings.config.Device` instead of raw strings when constructing configs in Python code.

Data Models
-----------

.. automodule:: streetparade_embeddings.models
   :members:
   :undoc-members:

API Schemas
-----------

.. automodule:: streetparade_embeddings.schemas
   :members:
   :undoc-members:

Database Utilities
------------------

.. automodule:: streetparade_embeddings.db
   :members:
   :undoc-members:

Response Helpers
----------------

.. automodule:: streetparade_embeddings.responses
   :members:
   :undoc-members:

Repository Helpers
------------------

.. automodule:: streetparade_embeddings.repositories
   :members:
   :undoc-members:

Preference Helpers
------------------

.. automodule:: streetparade_embeddings.preferences
   :members:
   :undoc-members:

User Visualization Helpers
--------------------------

.. automodule:: streetparade_embeddings.user_visualization
   :members:
   :undoc-members:

Provenance Helpers
------------------

.. automodule:: streetparade_embeddings.provenance
   :members:
   :undoc-members:

Vector Store
------------

.. automodule:: streetparade_embeddings.vectorstore
   :members:
   :undoc-members:

Audio Processing
----------------

.. automodule:: streetparade_embeddings.audio
   :members:
   :undoc-members:

SoundCloud Utilities
--------------------

.. automodule:: streetparade_embeddings.soundcloud
   :members:
   :undoc-members:

Use :class:`streetparade_embeddings.soundcloud.DiscoveryMethod` to choose between the ``requests-html`` and ``yt-dlp`` discovery backends.

YouTube Utilities
-----------------

.. automodule:: streetparade_embeddings.youtube
   :members:
   :undoc-members:

Embedding Model
---------------

.. automodule:: streetparade_embeddings.embeddings
   :members:
   :undoc-members:

Pipeline Orchestration
----------------------

.. automodule:: streetparade_embeddings.pipeline
   :members:
   :undoc-members:

Annotation Backend
------------------

The annotation backend in ``ml_pipeline/1_labeling/backend/app`` uses the same SQLite track and sample tables as the main backend, and adds campaign, label-set, label, item, and assignment tables for supervised labeling workflows.

.. automodule:: app.main
   :members:
   :undoc-members:

.. automodule:: app.schemas
   :members:
   :undoc-members:

.. automodule:: app.annotation_repositories
   :members:
   :undoc-members:

.. automodule:: app.db
   :members:
   :undoc-members:

.. automodule:: app.config
   :members:
   :undoc-members:
