"""Tests du corpus partagé : formules, définitions, propriétés, théorèmes, simulations.

Ce qu'on protège ici, dans l'ordre d'importance :
1. aucune boucle d'import possible, même quand deux entrées se citent mutuellement ;
2. une version cassée ne casse jamais les fiches des autres ;
3. changer une entrée recompile ce qui en dépend, sans jamais faire échouer la requête ;
4. plusieurs auteurs peuvent écrire leur version d'une même entrée.
"""
import json
import re

import pytest

from backend import corpus as corpus_module
from backend.corpus import EntryMeta, strip_references
from backend.errors import BrickInUseError, CorpusImportForbiddenError, EntryExistsError, InvalidRequestError, TypstCompileError, UnknownEntryError
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


# ---------------------------------------------------------------- hypothèses et limites d'une formule
#
# Une formule porte deux textes en plus de sa formule : ses hypothèses et ses limites. Ils
# s'écrivent à part (comme le code d'une brique), mais s'affichent en deux petits blocs sous la
# formule, dans l'encadré de l'entrée : sur la page du corpus ET dans les fiches qui l'insèrent.

FORMULE = "$ c = S_0 N(d_1) - K e^(-r T) N(d_2) $"
HYPOTHESES = "- rendements log-normaux, $sigma$ constante\n- taux sans risque $r$ constant\n"
LIMITES = "- sous-estime les queues épaisses\n"


def avec_sections(corpus, entry_id, hypotheses=None, limites=None, source=FORMULE, who=BAPTISTE):
    """Raccourci : enregistre une version de formule avec ses deux sections."""
    return corpus.save_version(entry_id, who["author"], who["name"], who["initials"], source, None, hypotheses, limites)


def hauteur(svg):
    """Hauteur d'une page SVG. Le texte y est converti en tracés : on ne peut pas y chercher un
    mot, mais un bloc de plus rend la page plus haute."""
    return float(re.search(r'<svg[^>]*\sheight="([\d.]+)', svg).group(1))


def test_une_formule_garde_ses_hypotheses_et_ses_limites(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes", titre="Black-Scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)

    dossier = site / "notes" / "corpus" / "black-scholes"
    # Chaque section est un fichier à part, à côté de la formule, au nom de l'auteur.
    assert (dossier / "baptiste.hypotheses.typ").read_text(encoding="utf-8") == HYPOTHESES
    assert (dossier / "baptiste.limites.typ").read_text(encoding="utf-8") == LIMITES
    assert (dossier / "baptiste.typ").read_text(encoding="utf-8") == FORMULE
    # L'éditeur les relit par load_version.
    fichiers = corpus.load_version("black-scholes", "baptiste")
    assert (fichiers.source, fichiers.hypotheses, fichiers.limites) == (FORMULE, HYPOTHESES, LIMITES)
    # Une fiche qui insère l'entrée y trouvera les trois textes, chacun derrière sa fonction.
    generated = (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")
    assert 'hypotheses: () => include "corpus/black-scholes/baptiste.hypotheses.typ"' in generated
    assert 'limites: () => include "corpus/black-scholes/baptiste.limites.typ"' in generated


def test_les_blocs_agrandissent_l_encadre_sur_la_page_du_corpus(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", source=FORMULE, who=MARIE)  # sans section
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES, who=BAPTISTE)
    dossier = site / "notes" / "corpus" / "black-scholes"
    sans = hauteur((dossier / "marie-1.svg").read_text(encoding="utf-8"))
    avec = hauteur((dossier / "baptiste-1.svg").read_text(encoding="utf-8"))
    # Deux blocs de plus : la page est nettement plus haute (de l'ordre de 100 pt).
    assert avec > sans + 50


def test_une_fiche_qui_insere_la_formule_montre_aussi_les_blocs(services):
    corpus = services.corpus
    creer(corpus, "sans-blocs")
    creer(corpus, "avec-blocs")
    avec_sections(corpus, "sans-blocs")
    avec_sections(corpus, "avec-blocs", HYPOTHESES, LIMITES)
    # Une vraie fiche a une page de hauteur libre (le gabarit) ; ici on la reproduit, sinon la page
    # est un A4 de hauteur fixe et rien ne se mesure.
    page = FICHE + "#set page(height: auto)\n"
    sans = hauteur(services.compiler.svg_pages(page + '#entree("sans-blocs")')[0])
    avec = hauteur(services.compiler.svg_pages(page + '#entree("avec-blocs")')[0])
    # La fiche passe par _corpus.typ (include des trois fichiers), pas par le rendu de la page
    # du corpus testé juste au-dessus : ce sont deux chemins, on vérifie les deux.
    assert avec > sans + 50


def test_une_section_vide_retire_son_fichier_et_son_bloc(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)
    fichier = site / "notes" / "corpus" / "black-scholes" / "baptiste.limites.typ"
    avec = hauteur((site / "notes" / "corpus" / "black-scholes" / "baptiste-1.svg").read_text(encoding="utf-8"))
    assert fichier.exists()

    # Des espaces seuls comptent pour « vide » : le bloc disparaît, le fichier aussi.
    avec_sections(corpus, "black-scholes", HYPOTHESES, "  \n")
    assert not fichier.exists()
    assert hauteur((site / "notes" / "corpus" / "black-scholes" / "baptiste-1.svg").read_text(encoding="utf-8")) < avec
    assert 'limites: none' in (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")
    assert 'hypotheses: () => include' in (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")


def test_ne_pas_envoyer_une_section_la_laisse_telle_quelle(services, site):
    # Un client qui n'envoie pas « limites » (None) ne l'efface pas : seul un texte vide le fait.
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)
    avec_sections(corpus, "black-scholes", "- une seule hypothèse\n", None)
    dossier = site / "notes" / "corpus" / "black-scholes"
    assert (dossier / "baptiste.hypotheses.typ").read_text(encoding="utf-8") == "- une seule hypothèse\n"
    assert (dossier / "baptiste.limites.typ").read_text(encoding="utf-8") == LIMITES


def test_chaque_auteur_a_ses_propres_sections(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES, who=BAPTISTE)
    avec_sections(corpus, "black-scholes", "- version de Marie\n", None, who=MARIE)
    dossier = site / "notes" / "corpus" / "black-scholes"
    assert (dossier / "marie.hypotheses.typ").read_text(encoding="utf-8") == "- version de Marie\n"
    assert not (dossier / "marie.limites.typ").exists()  # Marie n'en a pas écrit
    assert (dossier / "baptiste.limites.typ").exists()   # et ça ne touche pas celles de Baptiste
    # Les noms de fichiers des sections ne sont pas pris pour des auteurs.
    assert [v.author for v in corpus.get("black-scholes").versions] == ["baptiste", "marie"]


def test_les_sections_sont_reservees_aux_formules(services, site):
    corpus = services.corpus
    creer(corpus, "variance", type_="definition")
    with pytest.raises(InvalidRequestError) as raised:
        avec_sections(corpus, "variance", HYPOTHESES, None)
    assert raised.value.field == "hypotheses"
    assert not (site / "notes" / "corpus" / "variance" / "baptiste.hypotheses.typ").exists()
    # Une section vide n'est pas un contenu : un client qui envoie toujours les deux champs passe.
    avec_sections(corpus, "variance", "", "", source="La dispersion autour de la moyenne.")


def test_changer_le_type_d_une_formule_ignore_ses_sections(services, site):
    # Les fichiers restent (rien n'est perdu si on se ravise), mais ne sont plus affichés.
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)
    avant = hauteur((site / "notes" / "corpus" / "black-scholes" / "baptiste-1.svg").read_text(encoding="utf-8"))
    corpus.update_meta("black-scholes", EntryMeta("definition", "Black-Scholes"))
    apres = hauteur((site / "notes" / "corpus" / "black-scholes" / "baptiste-1.svg").read_text(encoding="utf-8"))
    assert apres < avant
    assert (site / "notes" / "corpus" / "black-scholes" / "baptiste.limites.typ").exists()
    assert "include" in (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")
    assert "baptiste.limites.typ" not in (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")


@pytest.mark.parametrize("fautive, ou", [
    ("source", dict(source="Ligne 1\n$ sigmaa $")),
    ("hypotheses", dict(hypotheses="- bonne\n- mauvaise $ sigmaa $\n")),
    ("limites", dict(limites="Première ligne\n\n$ sigmaa $\n")),
])
def test_une_erreur_designe_le_texte_fautif_et_sa_ligne(services, site, fautive, ou):
    # Trois textes, une seule boîte : sans précaution, l'erreur ne dirait pas lequel est en cause.
    # Le serveur compile chaque texte seul pour le trouver, et compte les lignes dans ce texte.
    corpus = services.corpus
    creer(corpus, "black-scholes")
    textes = dict(source=FORMULE, hypotheses=HYPOTHESES, limites=LIMITES) | ou
    with pytest.raises(TypstCompileError) as raised:
        avec_sections(corpus, "black-scholes", textes["hypotheses"], textes["limites"], source=textes["source"])
    erreur = raised.value
    assert erreur.part == fautive
    assert erreur.message == "unknown variable: sigmaa"
    assert erreur.line == {"source": 2, "hypotheses": 2, "limites": 3}[fautive]
    # Comme toute version cassée : tout le texte est enregistré, la version est exclue des fiches.
    assert erreur.saved is True
    assert corpus.get("black-scholes").versions[0].valid is False
    assert "baptiste" not in (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")
    assert erreur.extensions()["part"] == fautive


def test_une_erreur_sans_section_ne_porte_pas_de_partie(services):
    # Hors formule avec sections, la ligne se rapporte au seul texte : inutile d'ajouter la partie.
    creer(services.corpus, "bayes")
    with pytest.raises(TypstCompileError) as raised:
        version(services.corpus, "bayes", "Ligne 1\n$ sigmaa $")
    assert (raised.value.part, raised.value.line) == (None, 2)
    assert "part" not in raised.value.extensions()


def test_une_version_cassee_par_une_section_ne_casse_pas_les_fiches(services):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", source=FORMULE, who=MARIE)
    with pytest.raises(TypstCompileError):
        avec_sections(corpus, "black-scholes", "$ sigmaa $", None, who=BAPTISTE)
    # La version de Baptiste a quitté _corpus.typ, celle de Marie reste : la fiche compile.
    services.compiler.svg_pages(FICHE + '#entree("black-scholes")')
    # Corrigée, la version revient.
    avec_sections(corpus, "black-scholes", "$ sigma $", None, who=BAPTISTE)
    assert corpus.get("black-scholes").versions[0].valid is True
    assert "baptiste.hypotheses.typ" in (services.corpus.root / "_corpus.typ").read_text(encoding="utf-8")


def test_une_section_peut_citer_une_autre_entree(services):
    corpus = services.corpus
    creer(corpus, "loi-normale", type_="definition", titre="Loi normale")
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", CITE + '- rendements suivant la #voir("loi-normale")\n', None)
    # La citation faite dans une section compte comme celles du texte : rétrolien, dépendants.
    assert corpus.get("black-scholes").cites == ("loi-normale",)
    assert corpus.dependents("loi-normale").entries == (("black-scholes", "baptiste"),)
    # Donc renommer la loi normale recompile la formule, dont le bloc montre ce titre.
    _, rapport = corpus.update_meta("loi-normale", EntryMeta("definition", "Loi gaussienne"))
    assert rapport.rebuilt == ["corpus/black-scholes/baptiste"]


def test_une_section_ne_peut_pas_inserer_d_entree(services, site):
    # Même garde que pour le texte : une section qui insérerait une entrée ferait une boucle.
    creer(services.corpus, "black-scholes")
    for section in ("hypotheses", "limites"):
        with pytest.raises(CorpusImportForbiddenError):
            avec_sections(services.corpus, "black-scholes", **{section: '#entree("black-scholes")'})
    assert not (site / "notes" / "corpus" / "black-scholes" / "baptiste.typ").exists()


def test_l_apercu_montre_les_sections_sans_rien_ecrire(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    sans = hauteur(corpus.preview("formule", "Black-Scholes", "BD", FORMULE)[0])
    avec = hauteur(corpus.preview("formule", "Black-Scholes", "BD", FORMULE, HYPOTHESES, LIMITES)[0])
    assert avec > sans + 50
    # Un aperçu n'est qu'un aperçu : aucun fichier.
    assert not list((site / "notes" / "corpus" / "black-scholes").glob("baptiste*"))
    # Pour un autre type, les sections envoyées sont ignorées.
    definition = hauteur(corpus.preview("definition", "Variance", "BD", "Texte", HYPOTHESES, LIMITES)[0])
    assert definition == hauteur(corpus.preview("definition", "Variance", "BD", "Texte")[0])
    # Et une erreur d'aperçu désigne elle aussi le texte fautif.
    with pytest.raises(TypstCompileError) as raised:
        corpus.preview("formule", "Black-Scholes", "BD", FORMULE, HYPOTHESES, "$ sigmaa $")
    assert (raised.value.part, raised.value.line) == ("limites", 1)


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


def test_les_hypotheses_et_les_limites_par_l_api(api):
    api("POST", "/api/corpus", {"id": "black-scholes", "type": "formule", "titre": "Black-Scholes"})
    moi = {"name": "Baptiste Durand", "initials": "BD"}

    # Une version qui n'existe pas encore : les deux sections sont à null, l'éditeur les voit vides.
    _, _, body = api("GET", "/api/corpus/black-scholes/baptiste")
    assert (body["data"]["hypotheses"], body["data"]["limites"]) == (None, None)

    # Aperçu avec les sections, puis enregistrement, puis relecture.
    status, _, body = api("POST", "/api/compile/entry", {"type": "formule", "titre": "BS", "initials": "BD", "source": FORMULE, "hypotheses": HYPOTHESES, "limites": LIMITES})
    assert status == 200 and body["data"]["pages"][0].startswith("<svg")
    status, _, _ = api("PUT", "/api/corpus/black-scholes/baptiste", {"source": FORMULE, "hypotheses": HYPOTHESES, "limites": LIMITES, **moi})
    assert status == 200
    _, _, body = api("GET", "/api/corpus/black-scholes/baptiste")
    assert (body["data"]["source"], body["data"]["hypotheses"], body["data"]["limites"]) == (FORMULE, HYPOTHESES, LIMITES)

    # Une erreur dans une section : 422 habituel, avec la partie fautive et la ligne dans ce texte.
    status, _, body = api("PUT", "/api/corpus/black-scholes/baptiste", {"source": FORMULE, "hypotheses": HYPOTHESES, "limites": "ok\n$ sigmaa $", **moi})
    assert (status, body["title"], body["part"], body["line"], body["saved"]) == (422, "TYPST_COMPILE_ERROR", "limites", 2, True)

    # Un champ qui n'est pas du texte est refusé avant tout.
    status, _, body = api("PUT", "/api/corpus/black-scholes/baptiste", {"source": FORMULE, "hypotheses": 3, **moi})
    assert (status, body["field"]) == (422, "hypotheses")


# ---------------------------------------------------------------- suppression d'une entrée
#
# Supprimer une entrée retire aussi ses références, pour qu'aucune fiche ni entrée ne cite une
# entrée disparue (choix de Baptiste) : #voir devient le titre en texte simple, la phrase reste
# lisible ; #entree disparaît. Une brique encore importée par du code est refusée.


def test_retirer_les_references_d_une_entree_dans_un_texte():
    texte = (
        'Utilise #voir("bayes") ici.\n'  # citation dans une phrase : remplacée par le titre
        '#entree("bayes")\n'  # insertion seule sur sa ligne : la ligne disparaît
        'avant #entree("bayes", auteur: "m(a)rie") après\n'  # parenthèse dans une chaîne : sautée
        '#voir("bayes-2")\n'  # une autre entrée au nom proche : intacte
    )
    nouveau, nombre = strip_references(texte, "bayes", "Règle de *Bayes* [simple]")
    assert nombre == 3
    # Les caractères qui ont un sens en Typst sont échappés : le titre s'affiche tel quel.
    assert nouveau == 'Utilise Règle de \\*Bayes\\* \\[simple\\] ici.\navant  après\n#voir("bayes-2")\n'


def test_un_titre_echappe_s_affiche_tel_quel(services):
    # Vérifie l'échappement par Typst lui-même : le texte compile (un « [ » non échappé ouvrirait
    # un bloc de contenu jamais refermé).
    nouveau, _ = strip_references('#voir("x")', "x", "Coût [moyen] *pondéré* #1 $ @ref <a>")
    services.compiler.svg_pages(nouveau)


def test_supprimer_une_entree_efface_ses_fichiers_et_le_corpus_genere(services, site):
    corpus = services.corpus
    creer(corpus, "bayes", titre="Règle de Bayes")
    version(corpus, "bayes", "$ P(A|B) $", BAPTISTE)
    version(corpus, "bayes", "Version de Marie.", MARIE)
    rapport = corpus.delete("bayes")
    assert rapport.failed == []
    # Le dossier entier part : toutes les versions, leurs rendus.
    assert not (site / "notes" / "corpus" / "bayes").exists()
    # Les fichiers générés ne la connaissent plus.
    for fichier in ("_corpus-titres.typ", "_corpus.typ", "corpus/index.js"):
        assert '"bayes"' not in (site / "notes" / fichier).read_text(encoding="utf-8"), fichier
    with pytest.raises(UnknownEntryError):
        corpus.get("bayes")


def test_supprimer_une_entree_retire_ses_references_des_fiches(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes", titre="Règle de Bayes")
    version(corpus, "bayes", "$ P(A|B) $")
    notes.save(NoteTarget(12, "baptiste"), FICHE + 'Voir #voir("bayes").\n#entree("bayes")\nFin.')
    notes.save(NoteTarget(13, "marie"), FICHE + "Rien à voir.")
    rapport = corpus.delete("bayes")
    # La fiche qui l'utilisait est réécrite puis recompilée ; l'autre n'est pas touchée.
    assert rapport.rebuilt == ["notes/r12/fiche-baptiste"]
    assert notes.load(NoteTarget(12, "baptiste")) == FICHE + "Voir Règle de Bayes.\nFin."
    assert notes.load(NoteTarget(13, "marie")) == FICHE + "Rien à voir."
    # Et elle compile, sans l'entrée disparue.
    services.compiler.svg_pages(notes.load(NoteTarget(12, "baptiste")))


def test_supprimer_une_entree_retire_ses_references_des_autres_entrees(services, site):
    corpus = services.corpus
    creer(corpus, "loi-normale", type_="definition", titre="Loi normale")
    creer(corpus, "black-scholes")
    # Citée dans la section Hypothèses d'une version et dans le texte d'une autre.
    avec_sections(corpus, "black-scholes", CITE + '- rendements selon la #voir("loi-normale")\n', None, who=BAPTISTE)
    version(corpus, "black-scholes", CITE + 'Voir #voir("loi-normale").', who=MARIE)
    rapport = corpus.delete("loi-normale")
    dossier = site / "notes" / "corpus" / "black-scholes"
    assert (dossier / "baptiste.hypotheses.typ").read_text(encoding="utf-8") == CITE + "- rendements selon la Loi normale\n"
    assert (dossier / "marie.typ").read_text(encoding="utf-8") == CITE + "Voir Loi normale."
    # Les deux versions sont recompilées, restent valides, et ne citent plus rien.
    assert sorted(rapport.rebuilt) == ["corpus/black-scholes/baptiste", "corpus/black-scholes/marie"]
    entree = corpus.get("black-scholes")
    assert all(v.valid for v in entree.versions)
    assert entree.cites == ()


def test_une_fiche_qui_ne_compile_plus_est_rapportee_sans_bloquer(services):
    # La fiche contenait déjà sa propre erreur : elle est quand même réécrite, l'échec rapporté.
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    with pytest.raises(TypstCompileError):
        notes.save(NoteTarget(12, "baptiste"), FICHE + '#voir("bayes")\n#inconnu()')
    rapport = corpus.delete("bayes")
    assert rapport.failed == [{"target": "notes/r12/fiche-baptiste", "message": "unknown variable: inconnu"}]
    assert '#voir("bayes")' not in notes.load(NoteTarget(12, "baptiste"))
    assert not corpus.exists("bayes")


def test_une_brique_encore_importee_ne_se_supprime_pas(services, site):
    corpus = services.corpus
    creer(corpus, "outils", type_="brique")
    version(corpus, "outils", "Fonctions.", code="def f():\n    return 1\n")
    creer(corpus, "var-historique", type_="simulation")
    version(corpus, "var-historique", "Simulation.", code="from briques.outils import f\nprint(f())\n")
    with pytest.raises(BrickInUseError) as raised:
        corpus.delete("outils")
    assert raised.value.imported_by == ["var-historique"]
    # Rien n'a bougé.
    assert (site / "notes" / "corpus" / "outils" / "baptiste.py").exists()
    # Une fois l'import retiré, la suppression passe.
    version(corpus, "var-historique", "Simulation.", code="print(1)\n")
    corpus.delete("outils")
    assert not corpus.exists("outils")


def test_supprimer_une_entree_inconnue_donne_404(services):
    with pytest.raises(UnknownEntryError):
        services.corpus.delete("inconnue")


def test_la_suppression_par_l_api(api):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes"})
    api("PUT", "/api/notes/12/baptiste", {"source": FICHE + '#voir("bayes")'})
    # Une écriture doit déclarer du JSON, DELETE compris (garde du serveur) : corps {} ici.
    status, _, body = api("DELETE", "/api/corpus/bayes", {})
    assert status == 200
    assert body["data"]["deleted"] == "bayes"
    assert body["data"]["rebuild"]["rebuilt"] == ["notes/r12/fiche-baptiste"]
    status, _, body = api("DELETE", "/api/corpus/bayes", {})
    assert (status, body["title"]) == (404, "ENTRY_NOT_FOUND")
    status, _, body = api("GET", "/api/corpus")
    assert body["data"]["entries"] == []


def test_supprimer_une_brique_importee_par_l_api_donne_409(api, services):
    services.corpus.create("outils", EntryMeta("brique", "Outils"))
    version(services.corpus, "outils", "Texte.", code="def f():\n    return 1\n")
    services.corpus.create("sim", EntryMeta("simulation", "Sim"))
    version(services.corpus, "sim", "Texte.", code="import briques.outils\n")
    status, _, body = api("DELETE", "/api/corpus/outils", {})
    assert (status, body["title"], body["importedBy"]) == (409, "BRICK_IN_USE", ["sim"])


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
