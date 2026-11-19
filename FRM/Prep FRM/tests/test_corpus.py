"""Tests du corpus partagé : formules, définitions, propriétés, théorèmes, produits, simulations et
briques écrits par nous.

Depuis le 2026-11-19, une entrée est un seul fichier Markdown, notes/corpus/<id>.md, dans le
coffre Obsidian (notes/). Son en-tête YAML porte ce que le site gère (type, titre, readings
saisis, questions liées, variables) ; le corps porte le texte, puis « ## Hypothèses » et
« ## Limites » pour une formule, « ## Code » pour une simulation ou une brique.

Ce qu'on protège ici :
1. le format du fichier, lisible tel quel par Obsidian ;
2. une clé ajoutée dans Obsidian (tags, aliases…) n'est jamais perdue quand le site écrit ;
3. les liens [[id]] (citer) et ![[id]] (insérer), et ce qu'on en déduit : citations, rétroliens,
   readings tirés des fiches ;
4. les questions liées et les readings saisis à la main ;
5. la suppression d'une entrée, qui retire ses références partout ;
6. le parcours par l'API.
"""
import json

import pytest

from backend.corpus import EntryMeta, citations, strip_references
from backend.errors import BrickInUseError, EntryExistsError, InvalidRequestError, UnknownEntryError
from backend.frontmatter import Document
from backend.notes import NoteTarget


def fichier(site, entry_id):
    """Le texte brut du fichier de l'entrée, tel qu'Obsidian l'ouvre."""
    return (site / "notes" / "corpus" / f"{entry_id}.md").read_text(encoding="utf-8")


def en_tete(site, entry_id):
    """L'en-tête YAML du fichier, relu comme une propriété Obsidian."""
    return Document.parse(fichier(site, entry_id)).data


def manifeste(site):
    """notes/corpus/index.js, tel que les pages ouvertes sans serveur le lisent."""
    texte = (site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8")
    return json.loads(texte.split("FRM.registerCorpus(", 1)[1].rsplit(");", 1)[0])


def entree(corpus, entry_id, texte="", type_="definition", titre=None, **sections):
    """Raccourci : crée l'entrée puis, si un texte est donné, l'enregistre."""
    corpus.create(entry_id, EntryMeta(type_, titre or entry_id.capitalize()))
    if texte or sections:
        corpus.save_text(entry_id, texte, sections.pop("code", None), **sections)
    return corpus.get(entry_id)


# ---------------------------------------------------------------- création et format du fichier


def test_creer_une_entree_ecrit_un_fichier_markdown_et_le_manifeste(services, site):
    corpus = services.corpus
    corpus.create("bayes", EntryMeta("formule", "Règle de Bayes"))
    # Un seul fichier, nommé par l'identifiant : [[bayes]] le trouve aussi dans Obsidian.
    assert fichier(site, "bayes") == "---\ntype: formule\ntitre: Règle de Bayes\n---\n"
    assert sorted(p.name for p in (site / "notes" / "corpus").iterdir()) == ["bayes.md", "index.js"]
    # Le manifeste la décrit pour les pages ouvertes sans serveur.
    assert manifeste(site)["bayes"]["titre"] == "Règle de Bayes"
    assert manifeste(site)["bayes"]["hasText"] is False


def test_un_identifiant_deja_pris_est_refuse(services):
    services.corpus.create("bayes", EntryMeta("formule", "Règle de Bayes"))
    with pytest.raises(EntryExistsError) as raised:
        services.corpus.create("bayes", EntryMeta("definition", "Autre"))
    # L'erreur dit quel type a déjà l'identifiant : l'éditeur le montre.
    assert raised.value.existing_type == "formule"


def test_le_texte_est_le_corps_du_fichier(services, site):
    corpus = services.corpus
    entree(corpus, "bayes", "$$P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}$$\n", type_="formule")
    # Le texte suit l'en-tête, tel quel : c'est ce qu'Obsidian affiche.
    assert fichier(site, "bayes").endswith("---\n$$P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}$$\n")
    assert corpus.load_texts("bayes").source == "$$P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}$$\n"
    # Un nouvel enregistrement remplace le texte de tout le monde (git garde l'ancien).
    corpus.save_text("bayes", "Nouveau texte.\n", None)
    assert corpus.get("bayes").source == "Nouveau texte.\n"


def test_le_texte_d_une_entree_inconnue_est_refuse(services):
    with pytest.raises(UnknownEntryError):
        services.corpus.save_text("inconnue", "x", None)


# ---------------------------------------------------------------- ce qu'Obsidian ajoute est gardé


def test_une_cle_ajoutee_dans_obsidian_survit_a_toutes_les_ecritures_du_site(services, site):
    # Baptiste ajoute dans Obsidian des étiquettes et un alias, avec un commentaire YAML.
    corpus = services.corpus
    entree(corpus, "bayes", "Texte.\n", type_="formule")
    chemin = site / "notes" / "corpus" / "bayes.md"
    chemin.write_text(chemin.read_text(encoding="utf-8").replace("---\nTexte", "tags: [revoir]  # à revoir avant l'examen\naliases: [Bayes]\n---\nTexte"), encoding="utf-8")

    # Puis le site écrit de toutes les façons possibles : rattachement, question, titre, texte.
    corpus.change_readings(["bayes"], [3], [])
    corpus.link_question("bayes", "33", 3, linked=True)
    corpus.update_meta("bayes", EntryMeta("formule", "Règle de Bayes"))
    corpus.save_text("bayes", "Texte repris.\n", None, hypotheses="A et B sont des événements.")

    # Les clés d'Obsidian sont toujours là, avec leur commentaire ; celles du site ont changé.
    texte = fichier(site, "bayes")
    assert "tags: [revoir]  # à revoir avant l'examen" in texte
    assert "aliases: [Bayes]" in texte
    data = en_tete(site, "bayes")
    assert (data["titre"], list(data["readings"])) == ("Règle de Bayes", [3])


def test_un_fichier_sans_titre_ou_au_type_inconnu_reste_lisible(services, site):
    # Une note créée à la main dans Obsidian, sans en-tête complet : le site la montre quand même
    # (titre = identifiant, type par défaut) plutôt que de cacher le corpus entier.
    (site / "notes" / "corpus").mkdir(exist_ok=True)
    (site / "notes" / "corpus" / "note-libre.md").write_text("Juste du texte.\n", encoding="utf-8")
    trouvee = services.corpus.get("note-libre")
    assert (trouvee.meta.titre, trouvee.meta.type, trouvee.source) == ("note-libre", "definition", "Juste du texte.\n")


# ---------------------------------------------------------------- citer et insérer


def test_les_citations_obsidian_sont_reconnues():
    # [[id]] cite, ![[id]] insère ; un texte affiché ou une ancre ne changent pas la cible ;
    # une image n'est jamais une entrée (les identifiants n'ont pas de point).
    texte = "Voir [[bayes]], [[loi-normale|la loi normale]], [[var#Limites]]. ![[expected-loss]] ![[courbe.png|500]]"
    assert citations(texte) == {("voir", "bayes"), ("voir", "loi-normale"), ("voir", "var"), ("entree", "expected-loss")}


def test_deux_entrees_qui_se_citent_mutuellement_sont_liees_dans_les_deux_sens(services, site):
    # En Markdown, aucune boucle d'import n'est possible : deux entrées peuvent se citer.
    corpus = services.corpus
    entree(corpus, "a", "Voir [[b]].")
    entree(corpus, "b", "Voir [[a]].")
    assert (corpus.get("a").cites, corpus.get("b").cites) == (("b",), ("a",))
    payload = manifeste(site)
    assert (payload["a"]["citedBy"], payload["b"]["citedBy"]) == (["b"], ["a"])
    assert corpus.dependents("a").entries == ("b",)


def test_une_citation_dans_une_section_compte_aussi(services):
    corpus = services.corpus
    entree(corpus, "pd", "Probabilité de défaut.")
    entree(corpus, "el", "$EL = PD \\times LGD$", type_="formule", limites="La [[pd]] est point-in-time.")
    assert corpus.get("el").cites == ("pd",)


# ---------------------------------------------------------------- hypothèses, limites et code


def test_une_formule_garde_ses_hypotheses_et_ses_limites_en_sections(services, site):
    corpus = services.corpus
    entree(corpus, "bs", "$c = S_0 N(d_1) - K e^{-rT} N(d_2)$", type_="formule", hypotheses="- $\\sigma$ constante", limites="- smile de volatilité")
    # Deux sections à la fin du fichier, lisibles dans Obsidian.
    assert fichier(site, "bs").endswith("$c = S_0 N(d_1) - K e^{-rT} N(d_2)$\n\n## Hypothèses\n\n- $\\sigma$ constante\n\n## Limites\n\n- smile de volatilité\n")
    textes = corpus.load_texts("bs")
    assert (textes.source, textes.hypotheses, textes.limites) == ("$c = S_0 N(d_1) - K e^{-rT} N(d_2)$\n", "- $\\sigma$ constante", "- smile de volatilité")


def test_ne_pas_envoyer_une_section_la_laisse_et_une_section_vide_la_retire(services, site):
    corpus = services.corpus
    entree(corpus, "bs", "Formule.", type_="formule", hypotheses="H", limites="L")
    corpus.save_text("bs", "Formule reprise.", None)  # sections non envoyées : rien ne bouge
    assert (corpus.get("bs").hypotheses, corpus.get("bs").limites) == ("H", "L")
    corpus.save_text("bs", "Formule reprise.", None, limites="  ")  # vide : la section disparaît
    assert "## Limites" not in fichier(site, "bs")
    assert corpus.get("bs").hypotheses == "H"


def test_un_titre_hypotheses_dans_une_definition_reste_du_texte(services):
    # Les sections ne sont reconnues que pour les types qui en ont : ailleurs, un titre
    # « ## Hypothèses » écrit dans Obsidian appartient au texte, il ne disparaît pas.
    corpus = services.corpus
    entree(corpus, "risque", "Définition.\n\n## Hypothèses\n\nAucune.")
    assert "## Hypothèses" in corpus.get("risque").source
    assert corpus.get("risque").hypotheses is None


def test_les_sections_sont_reservees_aux_formules(services):
    corpus = services.corpus
    corpus.create("risque", EntryMeta("definition", "Risque"))
    with pytest.raises(InvalidRequestError) as raised:
        corpus.save_text("risque", "Texte.", None, hypotheses="H")
    assert raised.value.field == "hypotheses"


def test_une_simulation_garde_son_code_python_dans_une_section(services, site):
    corpus = services.corpus
    entree(corpus, "var-hist", "VaR historique.", type_="simulation", code="import numpy as np\nprint(np.pi)\n")
    assert fichier(site, "var-hist").endswith("## Code\n\n```python\nimport numpy as np\nprint(np.pi)\n```\n")
    assert corpus.get("var-hist").code == "import numpy as np\nprint(np.pi)"
    # Un bloc de code dans le texte (un exemple) n'est pas le code de la simulation.
    corpus.save_text("var-hist", "Exemple :\n\n```python\nprint(1)\n```\n", None)
    assert corpus.get("var-hist").code == "import numpy as np\nprint(np.pi)"


def test_le_code_python_est_reserve_aux_simulations_et_briques(services):
    corpus = services.corpus
    corpus.create("risque", EntryMeta("definition", "Risque"))
    with pytest.raises(InvalidRequestError) as raised:
        corpus.save_text("risque", "Texte.", "print(1)")
    assert raised.value.field == "code"


# ---------------------------------------------------------------- questions liées


def test_lier_une_question_l_ecrit_dans_l_en_tete_et_le_manifeste(services, site):
    corpus = services.corpus
    entree(corpus, "tail-loss", "Texte.")
    corpus.link_question("tail-loss", "33", 1, linked=True)
    corpus.link_question("tail-loss", "5", 1, linked=True)
    corpus.link_question("tail-loss", "33", 1, linked=True)  # deux fois : pas de doublon
    # Triées par reading puis numéro.
    assert [dict(q) for q in en_tete(site, "tail-loss")["questions"]] == [{"id": "5", "reading": 1}, {"id": "33", "reading": 1}]
    assert manifeste(site)["tail-loss"]["questions"] == [{"id": "5", "reading": 1}, {"id": "33", "reading": 1}]
    # Délier la dernière retire la clé.
    corpus.link_question("tail-loss", "5", 0, linked=False)
    corpus.link_question("tail-loss", "33", 0, linked=False)
    assert "questions" not in en_tete(site, "tail-loss")


def test_un_lien_rattache_l_entree_au_reading_de_la_question(services):
    corpus = services.corpus
    entree(corpus, "tail-loss", "Texte.")
    corpus.link_question("tail-loss", "33", 4, linked=True)
    trouvee = corpus.get("tail-loss")
    assert (trouvee.readings, trouvee.question_readings, trouvee.direct_readings) == ((4,), (4,), ())


# ---------------------------------------------------------------- readings saisis à la main


def test_rattacher_des_readings_l_ecrit_dans_l_en_tete(services, site):
    corpus = services.corpus
    entree(corpus, "bayes", "Texte.")
    corpus.change_readings(["bayes"], [5, 2], [])
    assert list(en_tete(site, "bayes")["readings"]) == [2, 5]
    # Écrits en ligne, comme Obsidian les montre : readings: [2, 5].
    assert "readings: [2, 5]" in fichier(site, "bayes")
    corpus.change_readings(["bayes"], [], [2, 5])
    assert "readings" not in en_tete(site, "bayes")


def test_changer_les_readings_de_plusieurs_entrees_a_la_fois(services):
    corpus = services.corpus
    entree(corpus, "a", "A.")
    entree(corpus, "b", "B.")
    changees = corpus.change_readings(["a", "b"], [7], [])
    assert [e.direct_readings for e in changees] == [(7,), (7,)]


def test_une_entree_inconnue_dans_le_lot_n_ecrit_rien(services):
    corpus = services.corpus
    entree(corpus, "a", "A.")
    with pytest.raises(UnknownEntryError):
        corpus.change_readings(["a", "inconnue"], [7], [])
    assert corpus.get("a").direct_readings == ()


def test_les_trois_origines_s_additionnent_sans_se_confondre(services):
    corpus = services.corpus
    entree(corpus, "bayes", "Texte.")
    corpus.change_readings(["bayes"], [2], [])
    corpus.link_question("bayes", "12", 3, linked=True)
    services.notes.save(NoteTarget(4), "Voir [[bayes]].\n")
    trouvee = corpus.get("bayes")
    assert (trouvee.direct_readings, trouvee.question_readings, trouvee.note_readings, trouvee.readings) == ((2,), (3,), (4,), (2, 3, 4))


# ---------------------------------------------------------------- readings tirés des fiches


def test_les_readings_d_une_entree_sont_ceux_des_fiches_qui_l_utilisent(services, site):
    corpus = services.corpus
    entree(corpus, "bayes", "Texte.")
    services.notes.save(NoteTarget(12), "Citée : [[bayes]].\n")
    services.notes.save(NoteTarget(15), "Insérée :\n\n![[bayes]]\n")
    assert corpus.get("bayes").note_readings == (12, 15)
    # Le service des fiches prévient le corpus après chaque enregistrement : le manifeste suit.
    assert manifeste(site)["bayes"]["noteReadings"] == [12, 15]


def test_une_citation_par_une_autre_entree_ne_rattache_pas(services):
    # Sinon tout finirait rattaché à tout.
    corpus = services.corpus
    entree(corpus, "bayes", "Texte.")
    entree(corpus, "loi-normale", "Voir [[bayes]].")
    corpus.change_readings(["loi-normale"], [9], [])
    assert corpus.get("bayes").readings == ()


# ---------------------------------------------------------------- suppression d'une entrée


def test_retirer_les_references_d_une_entree_dans_un_texte():
    # [[id]] devient le titre (ou le texte affiché), échappé ; ![[id]] seul sur sa ligne part avec elle.
    texte = "Voir [[bayes]] et [[bayes|la règle]].\n![[bayes]]\nFin [[autre]]."
    nouveau, nombre = strip_references(texte, "bayes", "Règle *de* Bayes")
    assert nouveau == "Voir Règle \\*de\\* Bayes et la règle.\nFin [[autre]]."
    assert nombre == 3


def test_supprimer_une_entree_retire_ses_references_des_fiches_et_des_entrees(services, site):
    corpus = services.corpus
    entree(corpus, "bayes", "Texte.", titre="Règle de Bayes")
    entree(corpus, "loi-normale", "Voir [[bayes]].")
    services.notes.save(NoteTarget(12), "## Formules\n\n![[bayes]]\n\nEt [[bayes]].\n")
    reecrits = corpus.delete("bayes")
    assert sorted(reecrits) == ["corpus/loi-normale", "notes/fiches/r12"]
    assert not (site / "notes" / "corpus" / "bayes.md").exists()
    assert corpus.get("loi-normale").source == "Voir Règle de Bayes.\n"
    assert services.notes.load(NoteTarget(12)) == "## Formules\n\n\nEt Règle de Bayes.\n"
    assert "bayes" not in manifeste(site)


def test_une_brique_encore_importee_ne_se_supprime_pas(services, site):
    corpus = services.corpus
    entree(corpus, "base", "Brique.", type_="brique", code="def un():\n    return 1\n")
    entree(corpus, "sim", "Simulation.", type_="simulation", code="from briques.base import un\nprint(un())\n")
    with pytest.raises(BrickInUseError) as raised:
        corpus.delete("base")
    assert raised.value.imported_by == ["sim"]
    assert (site / "notes" / "corpus" / "base.md").exists()


def test_supprimer_une_entree_inconnue_donne_une_erreur(services):
    with pytest.raises(UnknownEntryError):
        services.corpus.delete("inconnue")


# ---------------------------------------------------------------- API


def test_le_parcours_complet_par_l_api(api, site):
    status, _, body = api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Règle de Bayes"})
    assert status == 201
    assert body["links"]["text"]["href"] == "/api/corpus/bayes/texte"
    # Un champ « author » envoyé par un ancien client est ignoré : git dit qui écrit.
    status, _, body = api("PUT", "/api/corpus/bayes/texte", {"source": "$P(A)$", "hypotheses": "H", "author": "baptiste"})
    assert status == 200
    assert (body["data"]["source"], body["data"]["hypotheses"], body["data"]["hasText"]) == ("$P(A)$\n", "H", True)
    _, _, body = api("GET", "/api/corpus/bayes/texte")
    assert (body["data"]["source"], body["data"]["hypotheses"], body["data"]["limites"]) == ("$P(A)$\n", "H", None)
    status, _, body = api("PUT", "/api/corpus/bayes", {"type": "formule", "titre": "Bayes"})
    assert (status, body["data"]["titre"]) == (200, "Bayes")
    _, _, body = api("GET", "/api/corpus")
    assert [e["id"] for e in body["data"]["entries"]] == ["bayes"]
    status, _, body = api("DELETE", "/api/corpus/bayes", {})
    assert (status, body["data"]["deleted"]) == (200, "bayes")
    assert not (site / "notes" / "corpus" / "bayes.md").exists()


def test_les_erreurs_du_corpus_par_l_api(api):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes"})
    status, _, body = api("POST", "/api/corpus", {"id": "bayes", "type": "definition", "titre": "Autre"})
    assert (status, body["title"], body["existingType"]) == (409, "ENTRY_CONFLICT", "formule")
    status, _, body = api("GET", "/api/corpus/inconnue")
    assert (status, body["title"]) == (404, "ENTRY_NOT_FOUND")
    status, _, body = api("POST", "/api/corpus", {"id": "x", "type": "formule", "titre": "X"})
    assert (status, body["field"]) == (422, "id")


def test_lier_rattacher_par_l_api(api):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes"})
    status, _, body = api("PUT", "/api/corpus/bayes/questions/33", {"reading": 1})
    assert (status, body["data"]["questions"]) == (200, [{"id": "33", "reading": 1}])
    status, _, body = api("PUT", "/api/corpus/bayes/readings/5", {})
    assert body["data"]["directReadings"] == [5]
    status, _, body = api("POST", "/api/corpus/readings", {"entries": ["bayes"], "add": [6], "remove": [5]})
    assert [e["directReadings"] for e in body["data"]["entries"]] == [[6]]


def test_le_manifeste_du_corpus_suit_les_modifications_faites_dans_obsidian(api, site):
    # Une entrée modifiée dans Obsidian : la page qui charge le manifeste voit le nouveau texte.
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes"})
    chemin = site / "notes" / "corpus" / "bayes.md"
    chemin.write_text(chemin.read_text(encoding="utf-8") + "Écrit dans Obsidian.\n", encoding="utf-8")
    _, _, raw = api("GET", "/notes/corpus/index.js")
    assert "Écrit dans Obsidian." in raw.decode("utf-8")
