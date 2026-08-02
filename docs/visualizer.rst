Backend Visualizer And Deployment
=================================

The backend-backed visualizer lives in ``fe-visualizer/``. It is separate from the static GitHub Pages visualization and from the admin UI. It uses the FastAPI server for user management, submitted track analysis, live map data, layout recomputation, similarity links, audio streaming, and share links.

Local Development
-----------------

Start the API:

.. code-block:: bash

   STREETPARADE_DB=streetparade_embeddings.sqlite3 uvicorn streetparade_embeddings.api:app --reload

Start the visualizer development server:

.. code-block:: bash

   cd fe-visualizer
   npm install
   VITE_API_BASE_URL=http://localhost:8000 npm run dev

The development server listens on port ``5174`` by default.

Default Docker Setup
--------------------

The default Compose file starts the API, admin UI, and visualizer:

.. code-block:: bash

   docker compose up --build

Services are exposed as:

* API: ``http://localhost:8000``
* Admin UI: ``http://localhost:3000``
* Visualizer UI: ``http://localhost:3001``

Path-Prefixed ``/streetparade26/`` Setup
----------------------------------------

For deployment behind nginx under a path prefix, use the separate Compose file:

.. code-block:: bash

   docker compose -f docker-compose.streetparade26.yml up --build -d

Open the app at:

.. code-block:: text

   http://localhost:8080/streetparade26/

This setup builds the frontend with:

* ``VITE_BASE_PATH=/streetparade26/``
* ``VITE_API_BASE_URL=/streetparade26/api``

The dedicated nginx config in ``fe-visualizer/nginx.streetparade26.conf`` handles these routes:

* ``/streetparade26`` redirects to ``/streetparade26/``.
* ``/streetparade26/`` serves the React app and static assets.
* ``/streetparade26/api/*`` proxies to the backend API container after removing the prefix.
* ``/`` and other undefined paths return ``404`` instead of the default nginx page.

Visualizer Features
-------------------

The visualizer allows a public username to submit SoundCloud or YouTube links. The backend downloads/analyzes those tracks asynchronously and merges completed user-track embeddings into the shared embedding map.

Current interaction features include:

* Canvas-based map rendering with D3 zoom/pan and quadtree hit testing.
* Search across artists, tracks, URLs, and flat metadata.
* Song and artist visibility toggles.
* Cluster filtering and per-selection cluster highlighting.
* Undo/Redo selection history with buttons and ``Ctrl+Z`` / ``Ctrl+R``.
* Preference marking with stars.
* Share links containing username, marked preferences, and submitted songs.
* Selected-track similarity links from ``/similarity/track-embeddings``.
* Configurable neighbor count, similarity threshold, and cosine/euclidean metric for graph links.
* Artist selections that link to the artist's tracks.
* Point and edge hover tooltips.
* Tooltip actions for playing a similar song or selecting a random other song.
* Help modal explaining navigation, embeddings, PCA, t-SNE, and clustering.
* Mobile/coarse-pointer styling that reduces expensive filters and backdrop blurs.

Layout Recompute
----------------

The visualizer posts to ``/layouts/recompute`` and polls ``/layout-jobs/{job_id}``. Layout jobs can recompute 2D coordinates and clusters with optional PCA preprocessing.

Important layout options are:

* ``username``: include a user's completed submitted tracks in the layout.
* ``pca_enabled`` and ``pca_components``: configure PCA preprocessing.
* ``tsne_input``: choose ``raw`` or ``pca`` input for t-SNE.
* ``cluster_input``: choose ``raw`` or ``pca`` input for spectral clustering.
* ``cluster_count``: override the cluster count.
* ``tsne_perplexity``: override t-SNE perplexity.
* ``tsne_learning_rate``: numeric value or ``auto``.
* ``tsne_metric``: ``cosine``, ``euclidean``, or ``manhattan``.
* ``random_state``: seed for reproducible recomputes.

Similarity Links
----------------

The visualizer calls ``POST /similarity/track-embeddings`` for selected tracks. Requests may use ``metric: "cosine"`` or ``metric: "euclidean"``.

Cosine search uses the vector store. Euclidean search compares against the latest raw embeddings and reports similarity as ``1 / (1 + distance)``.
