"""Tests de bout en bout de l'API, avec un vrai serveur HTTP lancé dans un thread.

On vérifie le contrat vu par l'éditeur : enveloppe {data, links} en cas de succès, problem
details (RFC 9457) en cas d'erreur, et les fichiers réellement écrits sur disque.

Depuis le 2026-10-07, la fiche d'un reading est commune : une seule par reading, que chacun
modifie ; chaque écriture porte le profil de la personne, pour le journal des modifications.
"""
import json

# Le profil de la personne qui écrit, tel que l'éditeur l'envoie avec chaque enregistrement.
QUI = {"author": "baptiste", "name": "Baptiste Durand", "initials": "BD"}
MARIE = {"author": "marie", "name": "Marie Martin", "initials": "MM"}


def test_la_racine_liste_les_ressources(api):
    status, _, body = api("GET", "/api")
    assert status == 200
    # L'enveloppe standard : les données, et les liens vers les actions possibles.
    assert body["data"] == {"name": "prep-frm"}
    assert body["links"]["compile"] == {"rel": "compile", "href": "/api/compile", "method": "POST",
                                        "title": "Compiler une source Typst"}


def test_le_serveur_repond_a_l_etat_de_sante(api):
    status, _, body = api("GET", "/api/health")
    assert status == 200
    assert body["data"]["status"] == "ok"


def test_une_fiche_absente_n_est_pas_une_erreur(api):
    # Ouvrir l'éditeur sur une fiche jamais écrite est normal : 200, avec exists à False.
    status, _, body = api("GET", "/api/notes/12")
    assert status == 200
    assert body["data"]["exists"] is False
    assert body["data"]["source"] is None
    assert body["data"]["pages"] == []
    assert body["data"]["journal"] == []
    # Les liens disent comment enregistrer la fiche et prévisualiser.
    assert body["links"]["save"]["method"] == "PUT"
    assert body["links"]["save"]["href"] == "/api/notes/12"


def test_l_apercu_renvoie_le_svg_sans_rien_ecrire(api, site):
    avant = sorted(p.relative_to(site) for p in site.rglob("*"))
    status, _, body = api("POST", "/api/compile", {"source": "= Aperçu"})
    assert status == 200
    assert body["data"]["pages"][0].startswith("<svg")
    # L'aperçu ne doit créer ni modifier aucun fichier sur le disque.
    assert sorted(p.relative_to(site) for p in site.rglob("*")) == avant


def test_l_apercu_d_une_source_fausse_renvoie_un_probleme_422(api):
    status, headers, body = api("POST", "/api/compile", {"source": "= Titre\n$ sigmaa $"})
    assert status == 422
    assert headers["Content-Type"].startswith("application/problem+json")
    # Le code stable, testé par l'éditeur, et les champs qui alimentent son bandeau d'erreur.
    assert body["title"] == "TYPST_COMPILE_ERROR"
    assert body["line"] == 2
    assert body["saved"] is False
    assert body["instance"] == "/api/compile"


def test_enregistrer_ecrit_la_source_le_svg_le_pdf_et_le_manifeste(api, site):
    source = '#import "/_gabarit.typ": *\n= Probabilités\n#retenir[Bayes]'
    status, _, body = api("PUT", "/api/notes/12", {"source": source, **QUI})
    assert status == 200
    assert body["data"]["pages"] == ["/notes/r12/fiche-1.svg"]
    assert body["data"]["pdf"] == "/notes/r12/fiche.pdf"
    # Le premier enregistrement crée la fiche : le journal le dit.
    assert [(s["author"], s["creation"]) for s in body["data"]["journal"]] == [("baptiste", True)]

    folder = site / "notes" / "r12"
    assert (folder / "fiche.typ").read_text(encoding="utf-8") == source
    assert (folder / "fiche-1.svg").read_text(encoding="utf-8").startswith("<svg")
    assert (folder / "fiche.pdf").read_bytes().startswith(b"%PDF")
    assert (folder / "journal.jsonl").exists()

    # Le manifeste permet à la page Reading, même ouverte sans serveur, de savoir quoi afficher.
    manifest = (site / "notes" / "index.js").read_text(encoding="utf-8")
    payload = json.loads(manifest.split("FRM.registerNotes(", 1)[1].rsplit(");", 1)[0])
    assert (payload["12"]["pages"], payload["12"]["pdf"]) == (1, True)
    assert payload["12"]["journal"][0]["author"] == "baptiste"

    # Relue ensuite par l'API, la fiche existe et pointe vers ses fichiers compilés.
    _, _, note = api("GET", "/api/notes/12")
    assert note["data"]["exists"] is True
    assert note["data"]["source"] == source
    assert note["links"]["pdf"]["href"] == "/notes/r12/fiche.pdf"


def test_la_fiche_est_commune_et_le_journal_garde_chaque_personne(api, site):
    # Baptiste écrit la fiche, Marie la reprend : c'est le même fichier, et le journal garde les deux.
    api("PUT", "/api/notes/12", {"source": "= Fiche de départ", **QUI})
    api("PUT", "/api/notes/12", {"source": "= Fiche de départ\nAvec un ajout", **QUI})  # même séance
    status, _, body = api("PUT", "/api/notes/12", {"source": "= Fiche reprise par Marie", **MARIE})
    assert status == 200
    assert (site / "notes" / "r12" / "fiche.typ").read_text(encoding="utf-8") == "= Fiche reprise par Marie"
    assert sorted(p.name for p in (site / "notes" / "r12").glob("*.typ")) == ["fiche.typ"]
    sessions = [(s["author"], s["saves"], s["creation"]) for s in body["data"]["journal"]]
    assert sessions == [("baptiste", 2, True), ("marie", 1, False)]


def test_enregistrer_sans_profil_est_refuse(api, site):
    # Sans profil, le journal ne saurait pas qui écrit : la fiche n'est pas écrite.
    status, _, body = api("PUT", "/api/notes/12", {"source": "= Fiche"})
    assert (status, body["field"]) == (422, "author")
    assert not (site / "notes" / "r12" / "fiche.typ").exists()


def test_une_source_fausse_est_quand_meme_enregistree_et_garde_l_ancien_rendu(api, site):
    # Premier enregistrement valide : une page SVG existe.
    api("PUT", "/api/notes/12", {"source": "= Version 1", **QUI})
    rendu = (site / "notes" / "r12" / "fiche-1.svg").read_text(encoding="utf-8")

    # Deuxième enregistrement avec une erreur : le texte est écrit (aucun travail perdu),
    # mais le rendu précédent reste en place pour la page Reading.
    status, _, body = api("PUT", "/api/notes/12", {"source": "= Version 2\n$ sigmaa $", **QUI})
    assert status == 422
    assert body["title"] == "TYPST_COMPILE_ERROR"
    assert body["saved"] is True
    assert "sigmaa" in (site / "notes" / "r12" / "fiche.typ").read_text(encoding="utf-8")
    assert (site / "notes" / "r12" / "fiche-1.svg").read_text(encoding="utf-8") == rendu


def test_les_pages_en_trop_sont_supprimees(api, site):
    # Une fiche de deux pages repasse à une page : l'ancienne page 2 ne doit pas traîner.
    api("PUT", "/api/notes/12", {"source": "Page 1\n#pagebreak()\nPage 2", **QUI})
    assert (site / "notes" / "r12" / "fiche-2.svg").exists()
    api("PUT", "/api/notes/12", {"source": "Page unique", **QUI})
    assert not (site / "notes" / "r12" / "fiche-2.svg").exists()


def test_les_entrees_invalides_donnent_un_probleme_422(api):
    status, _, body = api("GET", "/api/notes/99")
    assert (status, body["title"], body["field"]) == (422, "INVALID_REQUEST_PAYLOAD", "reading")

    # L'auteur sert à identifier la personne dans le journal : même contrôle que l'ancien chemin.
    status, _, body = api("PUT", "/api/notes/12", {"source": "x", **QUI, "author": "../evil"})
    assert (status, body["field"]) == (422, "author")

    status, _, body = api("POST", "/api/compile", b"pas du json")
    assert (status, body["title"]) == (422, "INVALID_REQUEST_PAYLOAD")


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
    # fiche (deux onglets ouverts, par exemple) doivent laisser un état cohérent : la source,
    # la page SVG et le PDF viennent tous de la même version.
    import threading

    sources = [f"= Version {i}\n" + "texte " * 200 + ("\n#pagebreak()\nsuite" if i % 2 else "") for i in range(8)]
    threads = [threading.Thread(target=api, args=("PUT", "/api/notes/12", {"source": s, **QUI})) for s in sources]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    folder = site / "notes" / "r12"
    final = (folder / "fiche.typ").read_text(encoding="utf-8")
    pages = sorted(folder.glob("fiche-*.svg"))
    # La version gagnante a une ou deux pages selon sa parité : le nombre de SVG doit correspondre.
    attendu = 2 if "#pagebreak()" in final else 1
    assert len(pages) == attendu


def test_un_fichier_statique_absent_ne_pollue_pas_la_console(services, capfd):
    # Les pages chargent des scripts facultatifs (manifestes notes/index.js, notes/corpus/index.js)
    # et le navigateur sonde des fichiers de lui-même : un fichier statique absent est normal.
    # Le 404 doit bien être renvoyé au navigateur, mais sans ligne dans la console du serveur,
    # alors qu'un appel à l'API, lui, reste journalisé.
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
