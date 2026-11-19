"""Tests de bout en bout de l'API, avec un vrai serveur HTTP lancé dans un thread.

On vérifie le contrat vu par l'éditeur : enveloppe {data, links} en cas de succès, problem
details (RFC 9457) en cas d'erreur, et les fichiers réellement écrits sur disque.

La fiche d'un reading est commune (une seule par reading, que chacun modifie) et, depuis le
2026-11-19, c'est un fichier Markdown, notes/fiches/r<N>.md, qu'Obsidian modifie aussi. Le site
n'envoie plus qui écrit : l'historique vient de git (voir test_history.py).
"""
import json


def manifeste(site):
    """Le contenu de notes/index.js, tel que la page Reading le lit sans serveur."""
    texte = (site / "notes" / "index.js").read_text(encoding="utf-8")
    return json.loads(texte.split("FRM.registerNotes(", 1)[1].rsplit(");", 1)[0])


def test_la_racine_liste_les_ressources(api):
    status, _, body = api("GET", "/api")
    assert status == 200
    # L'enveloppe standard : les données, et les liens vers les actions possibles.
    assert body["data"] == {"name": "prep-frm"}
    assert body["links"]["run"]["href"] == "/api/run"
    # Plus de compilation : le rendu Markdown se fait dans le navigateur.
    assert "compile" not in body["links"]


def test_le_serveur_repond_a_l_etat_de_sante(api):
    status, _, body = api("GET", "/api/health")
    assert status == 200
    assert body["data"]["status"] == "ok"


def test_une_fiche_absente_n_est_pas_une_erreur(api):
    # Ouvrir l'éditeur sur une fiche jamais écrite est normal : 200, avec exists à False.
    status, _, body = api("GET", "/api/notes/12")
    assert status == 200
    assert body["data"]["exists"] is False
    assert body["data"]["source"] == ""
    assert body["data"]["journal"] == []
    # Les liens disent comment enregistrer la fiche.
    assert body["links"]["save"]["method"] == "PUT"
    assert body["links"]["save"]["href"] == "/api/notes/12"


def test_enregistrer_ecrit_le_markdown_et_le_manifeste(api, site):
    source = "---\nreading: 12\ntitre: Probabilités\n---\n## Intuition\n\n> [!tip] À retenir\n> Bayes : $P(A \\mid B)$\n"
    status, _, body = api("PUT", "/api/notes/12", {"source": source})
    assert status == 200
    assert body["data"]["source"] == source
    assert body["data"]["savedAt"] > 0

    # Le fichier est écrit tel quel, à l'endroit où Obsidian le trouve ; rien d'autre (ni SVG ni PDF).
    fichier = site / "notes" / "fiches" / "r12.md"
    assert fichier.read_text(encoding="utf-8") == source
    assert sorted(p.name for p in fichier.parent.iterdir()) == ["r12.md"]

    # Le manifeste porte la source : la page Reading, même ouverte sans serveur, l'affiche.
    assert manifeste(site)["12"]["source"] == source

    # Relue ensuite par l'API, la fiche existe.
    _, _, note = api("GET", "/api/notes/12")
    assert (note["data"]["exists"], note["data"]["source"]) == (True, source)


def test_le_manifeste_est_relu_a_chaque_chargement(api, site):
    # Obsidian modifie la fiche sans passer par le site : le serveur réécrit le manifeste chaque
    # fois qu'une page le charge, pour qu'elle montre le fichier tel qu'il est.
    api("PUT", "/api/notes/12", {"source": "Version du site\n"})
    (site / "notes" / "fiches" / "r12.md").write_text("Version d'Obsidian\n", encoding="utf-8")
    status, _, raw = api("GET", "/notes/index.js")
    assert status == 200
    assert "Version d'Obsidian" in raw.decode("utf-8")


def test_les_entrees_invalides_donnent_un_probleme_422(api):
    status, _, body = api("GET", "/api/notes/99")
    assert (status, body["title"], body["field"]) == (422, "INVALID_REQUEST_PAYLOAD", "reading")

    status, _, body = api("PUT", "/api/notes/12", b"pas du json")
    assert (status, body["title"]) == (422, "INVALID_REQUEST_PAYLOAD")


def test_les_anciennes_routes_de_compilation_n_existent_plus(api):
    # L'aperçu se fait dans le navigateur (markdown-it + KaTeX) : plus de /api/compile.
    for chemin in ("/api/compile", "/api/compile/entry"):
        status, _, body = api("POST", chemin, {"source": "x"})
        assert (status, body["title"]) == (404, "NOT_FOUND")


def test_une_route_inconnue_donne_un_probleme_404(api):
    status, headers, body = api("DELETE", "/api/notes/12")
    assert status == 404
    assert body["title"] == "NOT_FOUND"
    assert headers["Content-Type"].startswith("application/problem+json")


def test_les_fichiers_statiques_sont_servis_hors_api(api):
    status, headers, _ = api("GET", "/index.html")
    assert status == 200
    assert headers["Content-Type"].startswith("text/html")
    # Pas de cache : une fiche modifiée doit apparaître au rechargement.
    assert headers["Cache-Control"] == "no-store"


def test_deux_enregistrements_simultanes_ne_se_melangent_pas(api, site):
    # Le serveur traite les requêtes en parallèle. Deux enregistrements concurrents de la même
    # fiche (deux onglets ouverts, par exemple) doivent laisser un fichier entier, celui de l'une
    # des versions, et un manifeste qui dit la même chose.
    import threading

    sources = [f"## Version {i}\n" + "texte " * 500 for i in range(8)]
    threads = [threading.Thread(target=api, args=("PUT", "/api/notes/12", {"source": s})) for s in sources]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    final = (site / "notes" / "fiches" / "r12.md").read_text(encoding="utf-8")
    assert final in sources
    assert manifeste(site)["12"]["source"] == final


def test_un_fichier_statique_absent_ne_pollue_pas_la_console(services, capfd):
    # Les pages chargent des scripts facultatifs et le navigateur sonde des fichiers de lui-même :
    # un fichier statique absent est normal. Le 404 doit bien être renvoyé au navigateur, mais
    # sans ligne dans la console du serveur, alors qu'un appel à l'API, lui, reste journalisé.
    import threading
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer

    from backend.http.handler import make_handler

    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(services))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        try:
            urllib.request.urlopen(base + "/absent.js")
        except urllib.error.HTTPError as error:
            assert error.code == 404
        urllib.request.urlopen(base + "/api/health").read()
    finally:
        server.shutdown()
        server.server_close()
    console = capfd.readouterr().err
    assert "/absent.js" not in console
    assert "/api/health" in console
