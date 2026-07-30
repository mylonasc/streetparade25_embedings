from __future__ import annotations

import os
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

project = "Street Parade Embeddings"
author = "Street Parade Embeddings contributors"
release = "0.1.0"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.autosummary",
    "sphinx.ext.intersphinx",
    "sphinx.ext.napoleon",
    "sphinx_autodoc_typehints",
    "sphinxcontrib.plantuml",
    "myst_parser",
]

autosummary_generate = True
autodoc_member_order = "bysource"
autodoc_typehints = "description"
napoleon_google_docstring = True
napoleon_numpy_docstring = True

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "alabaster"
html_static_path = ["_static"]

PLANTUML_JAR_URL = "https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar"


def _plantuml_command() -> str:
    configured = os.environ.get("PLANTUML_COMMAND")
    if configured:
        return configured
    if shutil.which("plantuml"):
        return "plantuml"
    java = shutil.which("java")
    if not java or os.environ.get("PLANTUML_AUTO_DOWNLOAD", "1") == "0":
        return "plantuml"

    jar_path = ROOT / "docs" / "_build" / "plantuml" / "plantuml.jar"
    if not jar_path.exists():
        jar_path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(PLANTUML_JAR_URL, jar_path)
    return f"{java} -Djava.awt.headless=true -jar {jar_path}"


plantuml = _plantuml_command()
plantuml_output_format = "svg_img"

intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
    "numpy": ("https://numpy.org/doc/stable/", None),
}
