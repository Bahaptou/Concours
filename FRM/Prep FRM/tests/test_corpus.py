"""Tests du corpus partagé : formules, définitions, propriétés, théorèmes, simulations.

Ce qu'on protège ici, dans l'ordre d'importance :
1. aucune boucle d'import possible, même quand deux entrées se citent mutuellement ;
2. une version cassée ne casse jamais les fiches des autres ;
3. changer une entrée recompile ce qui en dépend, sans jamais faire échouer la requête ;
4. plusieurs auteurs peuvent écrire leur version d'une même entrée.
"""
import json

import pytest

from backend import corpus as corpus_module
from backend.corpus import EntryMeta
from backend.errors import CorpusImportForbiddenError, EntryExistsError, InvalidRequestError, TypstCompileError, UnknownEntryError
from backend.notes import NoteTarget

# En-tête qu'une version d'entrée écrit pour pouvoir citer d'autres entrées.
CITE = '#import "/_corpus-titres.typ": voir\n'
# En-tête qu'une fiche écrit pour citer ou insérer des entrées.
FICHE = '#import "/_corpus.typ": voir, entree\n'

BAPTISTE = dict(author="baptiste", name="Baptiste Durand", initials="BD")
MARIE = dict(author="marie", name="Marie Martin", initials="MM")


def creer(corpus, entry_id, type_="formule", titre=None):
    """Raccourci : crée une entrée et renvoie l'entrée créée."""
    entry, _ = corpus.create(entry_id, EntryMeta(type_, titre or entry_id.capitalize()))
    return entry


def version(corpus, entry_id, source, who=BAPTISTE, code=None):
    """Raccourci : enregistre une version et renvoie (entrée, rapport de recompilation)."""
    return corpus.save_version(entry_id, who["author"], who["name"], who["initials"], source, code)


# ---------------------------------------------------------------- création et versions


def test_creer_une_entree_ecrit_sa_meta_et_les_fichiers_generes(services, site):
    corpus = services.corpus
    entry = creer(corpus, "bayes", titre="Règle de Bayes")
    assert entry.meta.titre == "Règle de Bayes"
    meta = json.loads((site / "notes" / "corpus" / "bayes" / "entree.json").read_text(encoding="utf-8"))
    # Pas de readings stockés : ils viennent des fiches qui utilisent l'entrée.
    assert meta == {"type": "formule", "titre": "Règle de Bayes", "auteurs": {}}
    assert entry.readings == ()
    # Le titre est connu de #voir dès la création, même sans version.
    assert '"bayes": (type: "formule", titre: "Règle de Bayes")' in (site / "notes" / "_corpus-titres.typ").read_text(encoding="utf-8")


def test_un_identifiant_deja_pris_est_refuse(services):
    creer(services.corpus, "bayes")
    with pytest.raises(EntryExistsError) as raised:
        creer(services.corpus, "bayes", type_="definition")
    assert raised.value.existing_type == "formule"


def test_deux_auteurs_ont_chacun_leur_version(services, site):
    corpus = services.corpus
    creer(corpus, "variance", type_="definition")
    version(corpus, "variance", "$ sigma^2 = E[(X - mu)^2] $", BAPTISTE)
    entry, _ = version(corpus, "variance", "La dispersion autour de la moyenne.", MARIE)
    assert [(v.author, v.initials, v.valid) for v in entry.versions] == [("baptiste", "BD", True), ("marie", "MM", True)]
    # Chaque version a son propre rendu SVG.
    assert (site / "notes" / "corpus" / "variance" / "baptiste-1.svg").exists()
    assert (site / "notes" / "corpus" / "variance" / "marie-1.svg").exists()


def test_une_fiche_insere_toutes_les_versions_ou_celle_d_un_auteur(services):
    corpus = services.corpus
    creer(corpus, "variance", type_="definition")
    version(corpus, "variance", "Version de Baptiste.", BAPTISTE)
    version(corpus, "variance", "Version de Marie.", MARIE)
    # Une fiche qui insère l'entrée compile, avec toutes les versions ou une seule.
    services.compiler.svg_pages(FICHE + '#entree("variance")')
    services.compiler.svg_pages(FICHE + '#entree("variance", auteur: "marie")')
    # Un auteur sans version donne un message clair, pas une erreur obscure.
    with pytest.raises(TypstCompileError) as raised:
        services.compiler.svg_pages(FICHE + '#entree("variance", auteur: "paul")')
    assert "Pas de version valide" in raised.value.explanation


# ---------------------------------------------------------------- pas de boucle d'import


def test_deux_entrees_qui_se_citent_mutuellement_compilent(services):
    corpus = services.corpus
    creer(corpus, "bayes", titre="Règle de Bayes")
    creer(corpus, "proba-conditionnelle", type_="definition", titre="Probabilité conditionnelle")
    _, _ = version(corpus, "bayes", CITE + 'Utilise #voir("proba-conditionnelle").')
    entry, _ = version(corpus, "proba-conditionnelle", CITE + 'Voir #voir("bayes").')
    assert all(v.valid for v in entry.versions)
    # Les rétroliens sont relevés dans les deux sens.
    assert corpus.get("bayes").cites == ("proba-conditionnelle",)
    assert corpus.dependents("bayes").entries == (("proba-conditionnelle", "baptiste"),)
    # Une fiche qui insère les deux entrées compile aussi : aucune boucle.
    services.compiler.svg_pages(FICHE + '#entree("bayes")\n#entree("proba-conditionnelle")')


@pytest.mark.parametrize("source", [
    '#import "/_corpus.typ": entree\n#entree("bayes")',
    '#import "/_corpus.typ"\nTexte',
    '#entree("bayes")',
])
def test_une_entree_ne_peut_pas_importer_le_corpus_complet(services, site, source):
    # Si une entrée importait _corpus.typ, qui inclut les entrées, on aurait une boucle.
    # Le serveur le refuse avant d'écrire quoi que ce soit.
    creer(services.corpus, "bayes")
    with pytest.raises(CorpusImportForbiddenError):
        version(services.corpus, "bayes", source)
    assert not (site / "notes" / "corpus" / "bayes" / "baptiste.typ").exists()


# ---------------------------------------------------------------- versions cassées


def test_une_reference_inconnue_est_signalee_avec_sa_ligne(services, site):
    corpus = services.corpus
    creer(corpus, "bayes")
    with pytest.raises(TypstCompileError) as raised:
        version(corpus, "bayes", CITE + "Ligne 2\nCite #voir(\"bayse\") par erreur.")
    error = raised.value
    assert error.explanation == "Entrée inconnue du corpus : bayse"
    assert error.line == 3
    # Le texte est quand même enregistré (rien n'est perdu), mais la version est marquée invalide.
    assert error.saved is True
    assert "bayse" in (site / "notes" / "corpus" / "bayes" / "baptiste.typ").read_text(encoding="utf-8")
    assert corpus.get("bayes").versions[0].valid is False


def test_une_version_cassee_ne_casse_pas_les_fiches(services, site):
    corpus = services.corpus
    creer(corpus, "bayes")
    version(corpus, "bayes", "Version de Marie, valide.", MARIE)
    with pytest.raises(TypstCompileError):
        version(corpus, "bayes", "Version cassée #inconnu()", BAPTISTE)
    # La version cassée est exclue de _corpus.typ : une fiche qui insère l'entrée compile.
    assert "baptiste.typ" not in (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")
    services.compiler.svg_pages(FICHE + '#entree("bayes")')
    # Et une fiche qui se contente de citer n'est jamais touchée par le contenu des versions.
    services.compiler.svg_pages(FICHE + '#voir("bayes")')


def test_une_version_cassee_rapporte_quand_meme_ses_dependants(api, services):
    # Revue de worldtradefinance4 : quand la version échoue, les fiches qui insèrent l'entrée
    # sont recompilées (la version a quitté _corpus.typ). Le 422 doit dire ce qu'elles sont devenues.
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    version(corpus, "bayes", "Version valide.")
    notes.save(NoteTarget(12, "baptiste"), FICHE + '#entree("bayes")')

    status, _, body = api("PUT", "/api/corpus/bayes/baptiste", {"source": "#inconnu()", "name": "Baptiste Durand", "initials": "BD"})
    assert (status, body["title"], body["saved"]) == (422, "TYPST_COMPILE_ERROR", True)
    # L'entrée n'a plus de version valide : la fiche qui l'insère ne compile plus, et on le dit.
    assert body["rebuild"]["failed"][0]["target"] == "notes/r12/fiche-baptiste"


def test_une_erreur_hors_corpus_n_a_pas_de_rapport(api):
    # L'aperçu d'une fiche n'a pas de dépendants : le membre rebuild n'apparaît pas.
    _, _, body = api("POST", "/api/compile", {"source": "#inconnu()"})
    assert "rebuild" not in body


def test_une_entree_sans_version_valide_donne_un_message_clair(services):
    creer(services.corpus, "bayes")
    with pytest.raises(TypstCompileError) as raised:
        services.compiler.svg_pages(FICHE + '#entree("bayes")')
    assert "aucune version valide" in raised.value.explanation


# ---------------------------------------------------------------- dépendants


def test_changer_le_titre_recompile_les_entrees_et_fiches_qui_citent(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes", titre="Bayes")
    creer(corpus, "proba-conditionnelle", type_="definition")
    version(corpus, "proba-conditionnelle", CITE + 'Voir #voir("bayes").')
    notes.save(NoteTarget(12, "baptiste"), FICHE + 'Cite #voir("bayes").')

    _, report = corpus.update_meta("bayes", EntryMeta("formule", "Règle de Bayes"))
    # L'entrée qui cite et la fiche qui cite ont été recompilées (leur rendu montre le titre).
    assert "corpus/proba-conditionnelle/baptiste" in report.rebuilt
    assert "notes/r12/fiche-baptiste" in report.rebuilt
    assert report.failed == []
    assert corpus.get("bayes").meta.titre == "Règle de Bayes"


def test_l_echec_d_un_dependant_ne_fait_pas_echouer_la_modification(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    # Une fiche qui cite l'entrée mais contient par ailleurs sa propre erreur.
    with pytest.raises(TypstCompileError):
        notes.save(NoteTarget(12, "baptiste"), FICHE + '#voir("bayes")\n#inconnu()')
    entry, report = corpus.update_meta("bayes", EntryMeta("formule", "Nouveau titre"))
    # La modification a bien eu lieu ; l'échec de la fiche tierce est seulement rapporté.
    assert entry.meta.titre == "Nouveau titre"
    assert report.failed == [{"target": "notes/r12/fiche-baptiste", "message": "unknown variable: inconnu"}]


def test_au_dela_du_plafond_les_dependants_sont_signales_sans_etre_recompiles(services, monkeypatch):
    corpus, notes = services.corpus, services.notes
    monkeypatch.setattr(corpus_module, "MAX_SYNC_REBUILDS", 1)
    creer(corpus, "bayes")
    for reading in (12, 13, 14):
        notes.save(NoteTarget(reading, "baptiste"), FICHE + '#voir("bayes")')
    _, report = corpus.update_meta("bayes", EntryMeta("formule", "Titre"))
    assert len(report.rebuilt) == 1
    assert len(report.skipped) == 2


def test_modifier_une_version_recompile_les_fiches_qui_l_inserent(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    version(corpus, "bayes", "Première version.")
    notes.save(NoteTarget(12, "baptiste"), FICHE + '#entree("bayes")')
    notes.save(NoteTarget(13, "baptiste"), FICHE + '#voir("bayes")')
    _, report = version(corpus, "bayes", "Deuxième version.")
    # Seule la fiche qui insère le contenu change ; celle qui cite ne montre que le titre.
    assert report.rebuilt == ["notes/r12/fiche-baptiste"]


# ---------------------------------------------------------------- simulations


def test_une_simulation_garde_son_code_python(services, site):
    corpus = services.corpus
    creer(corpus, "var-historique", type_="simulation", titre="VaR historique")
    code = "import numpy as np\nprint(np.percentile([1, 2, 3], 5))\n"
    entry, _ = version(corpus, "var-historique", "Quantile des pertes passées.", code=code)
    assert entry.versions[0].code == code
    assert (site / "notes" / "corpus" / "var-historique" / "baptiste.py").read_text(encoding="utf-8") == code
    # Le manifeste embarque le code, pour la page Reading ouverte sans serveur.
    assert "np.percentile" in (site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8")


def test_le_code_python_est_reserve_aux_simulations(services):
    creer(services.corpus, "bayes")
    with pytest.raises(InvalidRequestError):
        version(services.corpus, "bayes", "Texte", code="print(1)")


def test_une_version_d_une_entree_inconnue_est_refusee(services):
    with pytest.raises(UnknownEntryError):
        version(services.corpus, "inconnue", "Texte")


# ---------------------------------------------------------------- API


def test_le_parcours_complet_par_l_api(api):
    # Créer l'entrée.
    # Des readings envoyés par un ancien client sont ignorés : seules les fiches en donnent.
    status, _, body = api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Règle de Bayes", "readings": [12]})
    assert status == 201
    assert body["data"]["readings"] == []
    assert body["links"]["update"]["method"] == "PUT"

    # Une version qui n'existe pas encore : 200 avec exists à False, et les liens pour l'écrire.
    status, _, body = api("GET", "/api/corpus/bayes/baptiste")
    assert (status, body["data"]["exists"]) == (200, False)
    assert body["links"]["save"]["href"] == "/api/corpus/bayes/baptiste"

    # Aperçu puis enregistrement.
    status, _, body = api("POST", "/api/compile/entry", {"type": "formule", "titre": "Règle de Bayes", "initials": "bd", "source": "$ x $"})
    assert status == 200 and body["data"]["pages"][0].startswith("<svg")
    status, _, body = api("PUT", "/api/corpus/bayes/baptiste", {"source": "$ x $", "name": "Baptiste Durand", "initials": "bd"})
    assert status == 200
    assert body["data"]["versions"][0]["initials"] == "BD"  # mises en majuscules
    assert body["data"]["rebuild"] == {"rebuilt": [], "failed": [], "skipped": []}

    # La liste du corpus.
    status, _, body = api("GET", "/api/corpus")
    assert [e["id"] for e in body["data"]["entries"]] == ["bayes"]


def test_les_erreurs_du_corpus_par_l_api(api):
    status, _, body = api("GET", "/api/corpus/inconnue")
    assert (status, body["title"]) == (404, "ENTRY_NOT_FOUND")

    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes"})
    status, _, body = api("POST", "/api/corpus", {"id": "bayes", "type": "definition", "titre": "Autre"})
    assert (status, body["title"], body["existingType"]) == (409, "ENTRY_CONFLICT", "formule")

    status, _, body = api("PUT", "/api/corpus/bayes/baptiste", {"source": '#import "/_corpus.typ"', "name": "B", "initials": "B"})
    assert (status, body["title"]) == (422, "CORPUS_IMPORT_FORBIDDEN")

    status, _, body = api("POST", "/api/corpus", {"id": "X", "type": "formule", "titre": "Bayes"})
    assert (status, body["field"]) == (422, "id")
    status, _, body = api("POST", "/api/corpus", {"id": "abc", "type": "lemme", "titre": "Bayes"})
    assert (status, body["field"]) == (422, "type")
    status, _, body = api("POST", "/api/corpus", {"id": "abc", "type": "formule", "titre": " "})
    assert (status, body["field"]) == (422, "titre")


# ---------------------------------------------------------------- readings tirés des fiches


def test_les_readings_d_une_entree_sont_ceux_des_fiches_qui_l_utilisent(services):
    # Une entrée s'écrit pour une fiche : c'est la fiche qui la rattache à son reading,
    # qu'elle la cite (#voir) ou l'insère (#entree).
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    version(corpus, "bayes", "Texte.")
    notes.save(NoteTarget(13, "marie"), FICHE + '#entree("bayes")')
    notes.save(NoteTarget(12, "baptiste"), FICHE + '#voir("bayes")')
    entry = corpus.get("bayes")
    assert entry.readings == (12, 13)
    assert [(n.reading, n.author) for n in entry.used_by] == [(12, "baptiste"), (13, "marie")]


def test_une_citation_par_une_autre_entree_ne_rattache_pas(services):
    # La fiche QA-1 cite « bayes », qui cite « proba-conditionnelle » : seule « bayes » reçoit
    # le reading 12, sinon tout finirait rattaché à tout.
    corpus, notes = services.corpus, services.notes
    creer(corpus, "proba-conditionnelle", type_="definition")
    creer(corpus, "bayes")
    version(corpus, "bayes", CITE + '#voir("proba-conditionnelle")')
    notes.save(NoteTarget(12, "baptiste"), FICHE + '#voir("bayes")')
    assert corpus.get("bayes").readings == (12,)
    assert corpus.get("proba-conditionnelle").readings == ()


def test_le_service_des_fiches_previent_apres_chaque_enregistrement(site):
    # Revue WTF4 : la coordination fiches → corpus vit dans la couche métier (un point
    # d'extension de NotesService), pas dans la route. Le service des fiches ne connaît pas le
    # corpus : il appelle juste on_saved, même quand la fiche ne compile pas (le texte est écrit).
    from backend.compiler import TypstCompiler
    from backend.notes import NotesService

    notes = NotesService(site / "notes", TypstCompiler(site / "notes"))
    appels = []
    notes.on_saved = lambda: appels.append("ok")
    notes.save(NoteTarget(12, "baptiste"), "= Fiche")
    with pytest.raises(TypstCompileError):
        notes.save(NoteTarget(12, "baptiste"), "#inconnu()")
    assert appels == ["ok", "ok"]


def test_enregistrer_une_fiche_met_a_jour_les_readings_du_corpus(api, site):
    # Le manifeste du corpus (lu par les pages sans serveur) suit chaque enregistrement de fiche :
    # ajouter la citation rattache l'entrée, la retirer la détache.
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes"})
    manifest = lambda: json.loads((site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8").split("FRM.registerCorpus(", 1)[1].rsplit(");", 1)[0])

    api("PUT", "/api/notes/12/baptiste", {"source": FICHE + '#voir("bayes")'})
    assert manifest()["bayes"]["readings"] == [12]
    assert manifest()["bayes"]["usedBy"] == [{"reading": 12, "author": "baptiste"}]
    _, _, body = api("GET", "/api/corpus/bayes")
    assert body["data"]["readings"] == [12]

    # Même une fiche qui ne compile pas a son texte écrit : le rattachement suit le texte.
    api("PUT", "/api/notes/12/baptiste", {"source": FICHE + "Plus de citation.\n#inconnu()"})
    assert manifest()["bayes"]["readings"] == []
