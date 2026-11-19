"""Fixtures partagées par les tests du serveur Prep FRM.

Chaque test travaille dans un dossier temporaire : on ne touche jamais au vrai dossier
`notes/` du projet. Le serveur de test tourne dans un thread, sur un port choisi par le système.

Le dossier temporaire n'est pas un dépôt git : l'historique des textes (backend/history.py) y est
vide, ce qui est le comportement voulu sans git. Les tests de l'historique créent leur propre dépôt
(fixture `git_site`).
"""
from __future__ import annotations

import json
import subprocess
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from backend.http.handler import make_handler
from server import build_services


@pytest.fixture
def site(tmp_path: Path) -> Path:
    """Un faux site : la racine statique, avec un dossier notes/ vide (le coffre Obsidian)."""
    (tmp_path / "notes").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>test</title>", encoding="utf-8")
    return tmp_path


@pytest.fixture
def services(site: Path):
    """Les services métier branchés sur le faux site (même assemblage que server.py).

    Comme au démarrage du serveur, on génère d'abord le manifeste du corpus (vide ici)."""
    services = build_services(static_root=site, notes_root=site / "notes")
    services.corpus.regenerate()
    return services


def git(folder: Path, *args: str, author: str = "Baptiste Durand") -> None:
    """Lance une commande git dans `folder`, au nom de `author` (e-mail fictif dérivé du nom)."""
    email = author.lower().replace(" ", ".") + "@exemple.test"
    env = {"GIT_AUTHOR_NAME": author, "GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_NAME": author, "GIT_COMMITTER_EMAIL": email}
    import os

    subprocess.run(["git", *args], cwd=folder, check=True, capture_output=True, env={**os.environ, **env})


@pytest.fixture
def git_site(site: Path) -> Path:
    """Le faux site, devenu un dépôt git (sans aucun commit pour l'instant)."""
    git(site, "init", "-q")
    git(site, "config", "commit.gpgsign", "false")
    return site


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
