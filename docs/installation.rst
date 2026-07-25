Installation
============

Editable Install
----------------

From the repository root:

.. code-block:: bash

   pip install -e .

For development and tests:

.. code-block:: bash

   pip install -e ".[dev]"

For documentation builds:

.. code-block:: bash

   pip install -e ".[docs]"

For rendered SoundCloud artist-page discovery using ``requests-html``:

.. code-block:: bash

   pip install -e ".[discovery]"

System Dependencies
-------------------

Audio processing and MP3 conversion require ``ffmpeg`` on the system path. On Debian or Ubuntu:

.. code-block:: bash

   sudo apt install ffmpeg

Python Environment
------------------

If the system Python is externally managed, create a virtual environment:

.. code-block:: bash

   python3 -m venv .venv
   .venv/bin/python -m pip install -e ".[dev,docs]"

The command-line entry point is installed as:

.. code-block:: bash

   streetparade-embeddings --help
