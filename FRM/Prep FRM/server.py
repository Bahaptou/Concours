"""Prep FRM local server: serves the site and the notes API (see ``backend/``).

Start it with ``uv run python server.py`` or by double-clicking ``Lancer Prep FRM.bat``.
It listens on 127.0.0.1 only and opens the browser on the home page (``--no-browser`` to skip).

API, under ``/api`` (responses ``{"data", "links"}``, errors as RFC 9457 problem details):
    GET  /api                            root, links to the other resources
    GET  /api/health                     server status
    POST /api/compile                    {"source"}: live preview, SVG pages, nothing written
    GET  /api/notes/<reading>/<author>   a note's source and compiled files
    PUT  /api/notes/<reading>/<author>   {"source"}: saves, then writes SVG pages and PDF if it compiles
    GET  /api/corpus                     corpus entries (formulas, definitions, properties, theorems, simulations)
    POST /api/corpus                     {"id", "type", "titre"}: creates an entry
    GET  /api/corpus/<id>                an entry, its versions, who cites it
    PUT  /api/corpus/<id>                {"type", "titre"}: updates it, recompiles dependents
    DELETE /api/corpus/<id>              deletes it and removes its references from notes and entries
    PUT|DELETE /api/corpus/<id>/questions/<q>  {"reading"} / {}: links or unlinks an AnalystPrep question
    GET  /api/corpus/<id>/<author>       a version's source (and Python code, assumptions, limits)
    PUT  /api/corpus/<id>/<author>       {"source", "name", "initials", "code"?, "hypotheses"?, "limites"?}: saves a version
    POST /api/compile/entry              {"type", "titre", "initials", "source", "hypotheses"?, "limites"?}: preview of a version
    POST /api/run                        {"code", "author", "timeout"}: runs simulation or brick code
    GET  /api/images                     shared images (notes/images/)
    POST /api/images                     {"name", "format", "data" (base64)}: adds an image, never replaces one
"""
from __future__ import annotations

import json
import logging
import socket
import sys
import urllib.request
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path

from backend.compiler import TypstCompiler
from backend.corpus import CorpusService
from backend.http.handler import make_handler
from backend.http.routes import Services
from backend.images import ImagesService
from backend.notes import NotesService
from backend.simulations import SimulationRunner

ROOT = Path(__file__).resolve().parent
NOTES = ROOT / "notes"
HOST = "127.0.0.1"
PORTS = range(8765, 8776)


def build_services(static_root: Path, notes_root: Path) -> Services:
    compiler = TypstCompiler(notes_root)
    notes = NotesService(notes_root, compiler)
    corpus = CorpusService(notes_root, compiler, notes)
    # Entries' readings come from the notes' citations: the corpus files follow every note save.
    notes.on_saved = corpus.regenerate
    simulations = SimulationRunner(corpus)
    images = ImagesService(notes_root)
    return Services(notes=notes, compiler=compiler, corpus=corpus, simulations=simulations, images=images, static_root=static_root)


def running_instance() -> str | None:
    """URL of a Prep FRM server already listening on the default port (launcher clicked twice)."""
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORTS.start}/api/health", timeout=1) as response:
            status = json.load(response).get("data", {}).get("status")
    except (OSError, ValueError, AttributeError):
        return None
    return f"http://{HOST}:{PORTS.start}/index.html" if status == "ok" else None


def free_port() -> int:
    for port in PORTS:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex((HOST, port)) != 0:
                return port
    sys.exit(f"Aucun port libre entre {PORTS.start} et {PORTS.stop - 1}.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    already = running_instance()
    if already:
        print(f"Prep FRM tourne déjà : {already}")
        if "--no-browser" not in sys.argv:
            webbrowser.open(already)
        return
    services = build_services(ROOT, NOTES)
    services.corpus.regenerate()  # _corpus-titres.typ and _corpus.typ must exist before any note compiles
    services.notes.write_manifest()
    port = free_port()
    if port != PORTS.start:
        # Browser storage is per address: another port means another (empty) progress.
        print(f"Attention : le port {PORTS.start} est pris par un autre programme. Sur ce port-ci, le navigateur "
              "ne retrouvera pas ta progression habituelle (charge ta sauvegarde si besoin).")
    server = ThreadingHTTPServer((HOST, port), make_handler(services))
    url = f"http://{HOST}:{port}/index.html"
    print(f"Prep FRM : {url}\nGarde cette fenêtre ouverte pendant que tu travailles ; ferme-la pour arrêter le serveur.")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
