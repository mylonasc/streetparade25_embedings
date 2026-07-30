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

PlantUML diagrams in the documentation require the Python Sphinx extension above and a PlantUML renderer. If Java is available and no ``plantuml`` executable is found, the Sphinx configuration downloads and caches ``plantuml.jar`` under ``docs/_build/plantuml/`` automatically. To use a system renderer instead, install PlantUML and Graphviz. On Debian or Ubuntu:

.. code-block:: bash

   sudo apt install plantuml graphviz

If PlantUML is installed somewhere else, point Sphinx at it with ``PLANTUML_COMMAND``. To disable automatic JAR download, set ``PLANTUML_AUTO_DOWNLOAD=0``.

.. code-block:: bash

   PLANTUML_COMMAND="java -jar /path/to/plantuml.jar" sphinx-build -b html docs docs/_build/html

SoundCloud artist-page discovery supports two backends. The ``yt-dlp`` backend is available in the base install. The legacy rendered-page backend requires ``requests-html``:

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

The package no longer installs command-line entry points. Use the Python modules, FastAPI app, or admin UI to operate the pipeline.
