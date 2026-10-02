"""Fixtures partagées par les tests du serveur Prep FRM.

Chaque test travaille dans un dossier temporaire : on ne touche jamais au vrai dossier
`notes/` du projet. Le serveur de test tourne dans un thread, sur un port choisi par le système.
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from backend.http.handler import make_handler
from server import build_services

# Le vrai gabarit du projet : les entrées du corpus ont besoin de ses encadrés (bloc-entree…).
GABARIT = (Path(__file__).resolve().parent.parent / "notes" / "_gabarit.typ").read_text(encoding="utf-8")


@pytest.fixture
def site(tmp_path: Path) -> Path:
    """Un faux site : la racine statique, avec un dossier notes/ contenant le gabarit."""
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "_gabarit.typ").write_text(GABARIT, encoding="utf-8")
    (tmp_path / "index.html").write_text("<!doctype html><title>test</title>", encoding="utf-8")
    return tmp_path


@pytest.fixture
def services(site: Path):
    """Les services métier branchés sur le faux site (même assemblage que server.py).

    Comme au démarrage du serveur, on génère d'abord les fichiers du corpus (vide ici)."""
    services = build_services(static_root=site, notes_root=site / "notes")
    services.corpus.regenerate()
    return services


@pytest.fixture
def api(services):
    """Démarre un vrai serveur HTTP dans un thread et renvoie une fonction d'appel.

    `api(méthode, chemin, corps)` renvoie (statut, en-têtes, JSON décodé). Le serveur est arrêté
    à la fin du test.
    """
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(services))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def call(method: str, path: str, body: dict | bytes | None = None):
        data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(base + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request) as response:
                raw = response.read()
                return response.status, response.headers, json.loads(raw) if raw[:1] in (b"{", b"[") else raw
        except urllib.error.HTTPError as error:
            # Les erreurs HTTP (4xx, 5xx) sont aussi des réponses à vérifier, pas des exceptions.
            return error.code, error.headers, json.loads(error.read())

    yield call
    server.shutdown()
    server.server_close()
