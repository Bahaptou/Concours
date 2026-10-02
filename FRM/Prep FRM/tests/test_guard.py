"""Tests de la garde des requêtes : le serveur ne répond qu'au site qu'il sert.

Le serveur écrit des fichiers et exécute du Python sur la machine. N'importe quelle page web
ouverte dans le navigateur peut envoyer des requêtes vers 127.0.0.1 : on vérifie ici que ces
requêtes venues d'ailleurs sont refusées, et que le site lui-même passe toujours.
"""
import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

from backend.http.handler import make_handler


@pytest.fixture
def raw(services):
    """Serveur de test, et une fonction d'appel où l'on choisit chaque en-tête à la main
    (urllib, lui, pose Host tout seul et ne permet pas de simuler un autre site)."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(services))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]

    def call(method, path, headers, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", port)
        # skip_host : on fournit Host nous-mêmes, pour pouvoir le falsifier.
        connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        data = json.dumps(body).encode() if body is not None else b""
        for name, value in {**headers, "Content-Length": str(len(data))}.items():
            connection.putheader(name, value)
        connection.endheaders(data)
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        is_json = response.getheader("Content-Type", "").startswith(("application/json", "application/problem+json"))
        return response.status, json.loads(payload) if is_json else payload

    yield call, port
    server.shutdown()
    server.server_close()


def test_le_site_lui_meme_passe(raw):
    # Ce qu'envoie le navigateur depuis http://127.0.0.1:<port> : même hôte, même origine, JSON.
    call, port = raw
    status, body = call("POST", "/api/compile", {"Host": f"127.0.0.1:{port}", "Origin": f"http://127.0.0.1:{port}",
                                                 "Content-Type": "application/json"}, {"source": "= Titre"})
    assert status == 200
    # localhost désigne la même machine : accepté aussi.
    status, _ = call("GET", "/api/health", {"Host": f"localhost:{port}"})
    assert status == 200


def test_une_page_d_un_autre_site_est_refusee(raw):
    # Une page ouverte sur un autre site envoie son origine : refus avant toute action.
    call, port = raw
    status, body = call("POST", "/api/compile", {"Host": f"127.0.0.1:{port}", "Origin": "https://exemple.com",
                                                 "Content-Type": "application/json"}, {"source": "= Titre"})
    assert (status, body["title"]) == (403, "FORBIDDEN_REQUEST")
    # Une page ouverte en double-clic (file://) envoie l'origine « null » : refusée aussi.
    status, _ = call("GET", "/api/health", {"Host": f"127.0.0.1:{port}", "Origin": "null"})
    assert status == 403


def test_un_hote_etranger_est_refuse_meme_pour_les_fichiers(raw):
    # « DNS rebinding » : un domaine étranger pointé sur 127.0.0.1 arrive avec son propre Host.
    # Refusé pour l'API comme pour les fichiers statiques (fiches, questions extraites).
    call, _ = raw
    status, body = call("GET", "/api/health", {"Host": "attaque.exemple.com"})
    assert (status, body["title"]) == (403, "FORBIDDEN_REQUEST")
    status, _ = call("GET", "/index.html", {"Host": "attaque.exemple.com"})
    assert status == 403


def test_une_ecriture_sans_json_est_refusee(raw):
    # text/plain ne déclenche pas de contrôle préalable du navigateur : c'est le type qu'une page
    # étrangère utiliserait. Seul application/json est accepté pour écrire.
    call, port = raw
    status, body = call("PUT", "/api/notes/12/baptiste", {"Host": f"127.0.0.1:{port}", "Content-Type": "text/plain"}, {"source": "x"})
    assert (status, body["title"], body["contentType"]) == (415, "UNSUPPORTED_MEDIA_TYPE", "text/plain")


def test_une_route_inconnue_reste_un_404(raw):
    # Le type de contenu n'est vérifié qu'une fois la route trouvée.
    call, port = raw
    status, body = call("DELETE", "/api/notes/12/baptiste", {"Host": f"127.0.0.1:{port}"})
    assert (status, body["title"]) == (404, "NOT_FOUND")


def test_l_execution_de_code_exige_aussi_du_json(raw):
    # /api/run est la route la plus sensible (elle exécute du Python) : même règle que les
    # écritures, refus avant toute exécution si le corps n'est pas déclaré en JSON.
    call, port = raw
    status, body = call("POST", "/api/run", {"Host": f"127.0.0.1:{port}", "Content-Type": "text/plain"},
                        {"code": "print('jamais exécuté')", "author": "baptiste"})
    assert (status, body["title"]) == (415, "UNSUPPORTED_MEDIA_TYPE")
    # Et depuis la page d'un autre site, même en JSON : refus.
    status, body = call("POST", "/api/run", {"Host": f"127.0.0.1:{port}", "Origin": "https://exemple.com",
                                              "Content-Type": "application/json"}, {"code": "print(1)", "author": "baptiste"})
    assert (status, body["title"]) == (403, "FORBIDDEN_REQUEST")
