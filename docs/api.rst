API Reference
=============

The public API is organized by pipeline responsibility.

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

CLI Module
----------

.. automodule:: streetparade_embeddings.cli
   :members:
   :undoc-members:
