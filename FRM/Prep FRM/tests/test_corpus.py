"""Tests du corpus partagé : formules, définitions, propriétés, théorèmes, simulations, briques.

Depuis le 2026-10-07 (choix de Baptiste), une entrée appartient à tout le monde : un seul texte,
que chacun modifie, et un journal qui garde qui l'a créée et qui l'a modifiée, quand.

Ce qu'on protège ici, dans l'ordre d'importance :
1. aucune boucle d'import possible, même quand deux entrées se citent mutuellement ;
2. un texte cassé ne casse jamais les fiches : elles gardent le dernier texte qui compilait ;
3. changer une entrée recompile ce qui en dépend, sans jamais faire échouer la requête ;
4. le journal note chaque modification de texte (pas les recompilations ni les liens aux questions).
"""
import json
import re

import pytest

from backend import corpus as corpus_module
from backend.corpus import EntryMeta, RebuildReport, strip_references
from backend.errors import BrickInUseError, CorpusImportForbiddenError, EntryExistsError, InvalidRequestError, TypstCompileError, UnknownEntryError
from backend.journal import Contributor
from backend.notes import NoteTarget

# En-tête qu'une entrée écrit pour pouvoir citer d'autres entrées.
CITE = '#import "/_corpus-titres.typ": voir\n'
# En-tête qu'une fiche écrit pour citer ou insérer des entrées.
FICHE = '#import "/_corpus.typ": voir, entree\n'

BAPTISTE = Contributor("baptiste", "Baptiste Durand", "BD")
MARIE = Contributor("marie", "Marie Martin", "MM")
# Le même profil, tel que l'éditeur l'envoie dans le corps des requêtes d'écriture.
QUI = {"author": "baptiste", "name": "Baptiste Durand", "initials": "BD"}


def creer(corpus, entry_id, type_="formule", titre=None, who=BAPTISTE):
    """Raccourci : crée une entrée et renvoie l'entrée créée."""
    entry, _ = corpus.create(entry_id, EntryMeta(type_, titre or entry_id.capitalize()), who)
    return entry


def texte(corpus, entry_id, source, who=BAPTISTE, code=None):
    """Raccourci : enregistre le texte commun de l'entrée et renvoie (entrée, rapport de recompilation)."""
    return corpus.save_text(entry_id, who, source, code)


def fiche(notes, reading, source, who=BAPTISTE):
    """Raccourci : enregistre la fiche commune d'un reading."""
    return notes.save(NoteTarget(reading), source, who)


def corpus_genere(site):
    return (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")


def manifeste(site):
    """Le manifeste du corpus (notes/corpus/index.js), décodé."""
    return json.loads((site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8").split("FRM.registerCorpus(", 1)[1].rsplit(");", 1)[0])


# ---------------------------------------------------------------- création et texte commun


def test_creer_une_entree_ecrit_sa_meta_son_journal_et_les_fichiers_generes(services, site):
    corpus = services.corpus
    entry = creer(corpus, "bayes", titre="Règle de Bayes")
    assert entry.meta.titre == "Règle de Bayes"
    meta = json.loads((site / "notes" / "corpus" / "bayes" / "entree.json").read_text(encoding="utf-8"))
    # Ni readings (ils viennent des fiches et des questions) ni auteurs (l'entrée est à tous).
    assert meta == {"type": "formule", "titre": "Règle de Bayes"}
    assert entry.readings == ()
    # Le journal dit qui l'a créée : une séance, marquée création.
    assert [(s.author, s.creation, s.saves) for s in entry.journal] == [("baptiste", True, 1)]
    # Pas encore de texte.
    assert (entry.has_text, entry.valid) == (False, False)
    # Le titre est connu de #voir dès la création, même sans texte.
    assert '"bayes": (type: "formule", titre: "Règle de Bayes")' in (site / "notes" / "_corpus-titres.typ").read_text(encoding="utf-8")


def test_un_identifiant_deja_pris_est_refuse(services):
    creer(services.corpus, "bayes")
    with pytest.raises(EntryExistsError) as raised:
        creer(services.corpus, "bayes", type_="definition")
    assert raised.value.existing_type == "formule"


def test_l_entree_a_un_seul_texte_que_chacun_modifie(services, site):
    corpus = services.corpus
    creer(corpus, "variance", type_="definition")
    texte(corpus, "variance", "$ sigma^2 = E[(X - mu)^2] $", BAPTISTE)
    entry, _ = texte(corpus, "variance", "La dispersion autour de la moyenne.", MARIE)
    dossier = site / "notes" / "corpus" / "variance"
    # Marie a modifié LE texte de l'entrée : il n'y a pas de version par personne.
    assert (dossier / "texte.typ").read_text(encoding="utf-8") == "La dispersion autour de la moyenne."
    assert sorted(p.name for p in dossier.glob("*.typ")) == ["texte.typ"]
    assert (dossier / "page-1.svg").exists()
    assert (entry.has_text, entry.valid) == (True, True)
    # Le journal garde les deux personnes : Baptiste (création, puis son texte, dans la même
    # séance), puis Marie.
    assert [(s.author, s.creation, s.saves) for s in entry.journal] == [("baptiste", True, 2), ("marie", False, 1)]


def test_une_fiche_insere_le_texte_de_l_entree(services):
    corpus = services.corpus
    creer(corpus, "variance", type_="definition")
    texte(corpus, "variance", "La dispersion autour de la moyenne.")
    services.compiler.svg_pages(FICHE + '#entree("variance")')
    # Les fiches écrites quand chacun avait sa version passaient « auteur: » : accepté, ignoré.
    services.compiler.svg_pages(FICHE + '#entree("variance", auteur: "marie")')


# ---------------------------------------------------------------- pas de boucle d'import


def test_deux_entrees_qui_se_citent_mutuellement_compilent(services):
    corpus = services.corpus
    creer(corpus, "bayes", titre="Règle de Bayes")
    creer(corpus, "proba-conditionnelle", type_="definition", titre="Probabilité conditionnelle")
    texte(corpus, "bayes", CITE + 'Utilise #voir("proba-conditionnelle").')
    entry, _ = texte(corpus, "proba-conditionnelle", CITE + 'Voir #voir("bayes").')
    assert entry.valid
    # Les rétroliens sont relevés dans les deux sens.
    assert corpus.get("bayes").cites == ("proba-conditionnelle",)
    assert corpus.dependents("bayes").entries == ("proba-conditionnelle",)
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
        texte(services.corpus, "bayes", source)
    assert not (site / "notes" / "corpus" / "bayes" / "texte.typ").exists()


# ---------------------------------------------------------------- textes cassés : le dernier valide reste


def test_une_reference_inconnue_est_signalee_avec_sa_ligne(services, site):
    corpus = services.corpus
    creer(corpus, "bayes")
    with pytest.raises(TypstCompileError) as raised:
        texte(corpus, "bayes", CITE + "Ligne 2\nCite #voir(\"bayse\") par erreur.")
    error = raised.value
    assert error.explanation == "Entrée inconnue du corpus : bayse"
    assert error.line == 3
    # Le texte est quand même enregistré (rien n'est perdu), mais l'entrée est marquée invalide.
    assert error.saved is True
    assert "bayse" in (site / "notes" / "corpus" / "bayes" / "texte.typ").read_text(encoding="utf-8")
    assert corpus.get("bayes").valid is False


def test_un_texte_casse_laisse_les_fiches_sur_le_dernier_texte_valide(services, site):
    # Choix de Baptiste : personne n'est bloqué par l'erreur d'un autre. Quand Marie casse une
    # entrée qui compilait, les fiches continuent d'afficher le dernier texte qui compilait.
    corpus = services.corpus
    creer(corpus, "bayes")
    texte(corpus, "bayes", "Texte valide.", BAPTISTE)
    with pytest.raises(TypstCompileError):
        texte(corpus, "bayes", "Texte cassé #inconnu()", MARIE)
    dossier = site / "notes" / "corpus" / "bayes"
    # Le texte cassé est bien enregistré (c'est celui que l'éditeur rouvrira)…
    assert (dossier / "texte.typ").read_text(encoding="utf-8") == "Texte cassé #inconnu()"
    # … et une copie du texte valide est gardée à part, pour les fiches.
    assert (dossier / "valide" / "texte.typ").read_text(encoding="utf-8") == "Texte valide."
    assert '"corpus/bayes/valide/texte.typ"' in corpus_genere(site)
    services.compiler.svg_pages(FICHE + '#entree("bayes")')
    # Le manifeste dit que l'entrée ne compile pas (la page de l'entrée l'affiche).
    assert manifeste(site)["bayes"]["valid"] is False

    # Corrigée, l'entrée compile de nouveau : les fiches reprennent son texte, la copie s'en va.
    texte(corpus, "bayes", "Texte corrigé.", MARIE)
    assert not (dossier / "valide").exists()
    assert '"corpus/bayes/texte.typ"' in corpus_genere(site)
    assert manifeste(site)["bayes"]["valid"] is True


def test_la_copie_garde_le_dernier_texte_qui_compilait(services, site):
    # Deux enregistrements cassés de suite : la copie reste celle d'avant le premier, pas le
    # premier texte cassé.
    corpus = services.corpus
    creer(corpus, "bayes")
    texte(corpus, "bayes", "Texte valide.")
    for cassé in ("Cassé 1 #inconnu()", "Cassé 2 #inconnu()"):
        with pytest.raises(TypstCompileError):
            texte(corpus, "bayes", cassé)
    assert (site / "notes" / "corpus" / "bayes" / "valide" / "texte.typ").read_text(encoding="utf-8") == "Texte valide."


def test_une_entree_qui_n_a_jamais_compile_est_absente_des_fiches(services, site):
    corpus = services.corpus
    creer(corpus, "bayes")
    with pytest.raises(TypstCompileError):
        texte(corpus, "bayes", "Cassé dès le début #inconnu()")
    # Rien à garder : pas de copie, et l'entrée n'est pas dans _corpus.typ.
    assert not (site / "notes" / "corpus" / "bayes" / "valide").exists()
    assert "corpus/bayes/" not in corpus_genere(site)
    # Une fiche qui l'insère reçoit un message clair, pas une erreur obscure.
    with pytest.raises(TypstCompileError) as raised:
        services.compiler.svg_pages(FICHE + '#entree("bayes")')
    assert "aucun texte qui compile" in raised.value.explanation


def test_une_entree_sans_texte_donne_un_message_clair(services):
    creer(services.corpus, "bayes")
    with pytest.raises(TypstCompileError) as raised:
        services.compiler.svg_pages(FICHE + '#entree("bayes")')
    assert "aucun texte qui compile" in raised.value.explanation


def test_un_texte_casse_par_l_api_rapporte_ses_dependants(api, services):
    # Revue de worldtradefinance4 : quand le texte échoue, les fiches qui insèrent l'entrée sont
    # recompilées, et le 422 dit ce qu'elles sont devenues. Ici elle compile toujours : elle
    # affiche le dernier texte valide.
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    texte(corpus, "bayes", "Texte valide.")
    fiche(notes, 12, FICHE + '#entree("bayes")')

    status, _, body = api("PUT", "/api/corpus/bayes/texte", {"source": "#inconnu()", **QUI})
    assert (status, body["title"], body["saved"]) == (422, "TYPST_COMPILE_ERROR", True)
    assert body["rebuild"] == {"rebuilt": ["notes/r12/fiche"], "failed": [], "skipped": []}


def test_une_erreur_hors_corpus_n_a_pas_de_rapport(api):
    # L'aperçu d'une fiche n'a pas de dépendants : le membre rebuild n'apparaît pas.
    _, _, body = api("POST", "/api/compile", {"source": "#inconnu()"})
    assert "rebuild" not in body


def test_une_recompilation_qui_echoue_garde_aussi_le_dernier_texte_valide(services, site, monkeypatch):
    # Une entrée peut cesser de compiler sans qu'on touche à son texte (une entrée qu'elle cite a
    # changé…). Son texte, qui compilait jusque-là, est alors gardé pour les fiches.
    corpus = services.corpus
    creer(corpus, "bayes")
    texte(corpus, "bayes", "Texte valide.")

    def echec(*args, **kwargs):
        raise TypstCompileError("panne simulée", [], None, None)

    monkeypatch.setattr(corpus, "_box_pages", echec)
    rapport = RebuildReport()
    corpus._rerender_into("bayes", rapport)
    assert rapport.failed == [{"target": "corpus/bayes", "message": "panne simulée"}]
    assert corpus.get("bayes").valid is False
    assert (site / "notes" / "corpus" / "bayes" / "valide" / "texte.typ").read_text(encoding="utf-8") == "Texte valide."


# ---------------------------------------------------------------- dépendants


def test_changer_le_titre_recompile_les_entrees_et_fiches_qui_citent(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes", titre="Bayes")
    creer(corpus, "proba-conditionnelle", type_="definition")
    texte(corpus, "proba-conditionnelle", CITE + 'Voir #voir("bayes").')
    fiche(notes, 12, FICHE + 'Cite #voir("bayes").')

    _, report = corpus.update_meta("bayes", EntryMeta("formule", "Règle de Bayes"), BAPTISTE)
    # L'entrée qui cite et la fiche qui cite ont été recompilées (leur rendu montre le titre).
    assert "corpus/proba-conditionnelle" in report.rebuilt
    assert "notes/r12/fiche" in report.rebuilt
    assert report.failed == []
    assert corpus.get("bayes").meta.titre == "Règle de Bayes"


def test_l_echec_d_un_dependant_ne_fait_pas_echouer_la_modification(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    # Une fiche qui cite l'entrée mais contient par ailleurs sa propre erreur.
    with pytest.raises(TypstCompileError):
        fiche(notes, 12, FICHE + '#voir("bayes")\n#inconnu()')
    entry, report = corpus.update_meta("bayes", EntryMeta("formule", "Nouveau titre"), BAPTISTE)
    # La modification a bien eu lieu ; l'échec de la fiche tierce est seulement rapporté.
    assert entry.meta.titre == "Nouveau titre"
    assert report.failed == [{"target": "notes/r12/fiche", "message": "unknown variable: inconnu"}]


def test_au_dela_du_plafond_les_dependants_sont_signales_sans_etre_recompiles(services, monkeypatch):
    corpus, notes = services.corpus, services.notes
    monkeypatch.setattr(corpus_module, "MAX_SYNC_REBUILDS", 1)
    creer(corpus, "bayes")
    for reading in (12, 13, 14):
        fiche(notes, reading, FICHE + '#voir("bayes")')
    _, report = corpus.update_meta("bayes", EntryMeta("formule", "Titre"), BAPTISTE)
    # La boîte de l'entrée elle-même n'a pas de texte à recompiler : seules les fiches comptent.
    assert len(report.rebuilt) == 1
    assert len(report.skipped) == 2


def test_modifier_le_texte_recompile_les_fiches_qui_l_inserent(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    texte(corpus, "bayes", "Premier texte.")
    fiche(notes, 12, FICHE + '#entree("bayes")')
    fiche(notes, 13, FICHE + '#voir("bayes")')
    _, report = texte(corpus, "bayes", "Deuxième texte.")
    # Seule la fiche qui insère le contenu change ; celle qui cite ne montre que le titre.
    assert report.rebuilt == ["notes/r12/fiche"]


# ---------------------------------------------------------------- journal des modifications


def test_le_journal_garde_qui_a_cree_et_qui_a_modifie(services, site):
    corpus = services.corpus
    creer(corpus, "bayes", who=BAPTISTE)
    texte(corpus, "bayes", "Texte de Baptiste.", BAPTISTE)
    texte(corpus, "bayes", "Texte repris par Marie.", MARIE)
    corpus.update_meta("bayes", EntryMeta("formule", "Règle de Bayes"), MARIE)
    journal = manifeste(site)["bayes"]["journal"]
    # Baptiste : création et texte dans la même séance ; Marie : texte et titre dans la sienne.
    assert [(s["author"], s["creation"], s["saves"]) for s in journal] == [("baptiste", True, 2), ("marie", False, 2)]
    # La dernière modification de l'entrée est la fin de la dernière séance.
    assert manifeste(site)["bayes"]["updatedAt"] == journal[-1]["end"]


def test_lier_une_question_ou_recompiler_ne_compte_pas_comme_une_modification(services):
    # Le journal suit les changements de texte, pas les associations ni les recompilations.
    corpus = services.corpus
    creer(corpus, "bayes")
    creer(corpus, "proba", type_="definition")
    texte(corpus, "proba", CITE + 'Voir #voir("bayes").')
    avant = corpus.get("proba").journal
    corpus.link_question("proba", "315", 12, linked=True)
    corpus.update_meta("bayes", EntryMeta("formule", "Nouveau titre"), MARIE)  # recompile « proba »
    assert corpus.get("proba").journal == avant


# ---------------------------------------------------------------- simulations


def test_une_simulation_garde_son_code_python(services, site):
    corpus = services.corpus
    creer(corpus, "var-historique", type_="simulation", titre="VaR historique")
    code = "import numpy as np\nprint(np.percentile([1, 2, 3], 5))\n"
    entry, _ = texte(corpus, "var-historique", "Quantile des pertes passées.", code=code)
    assert entry.code == code
    assert (site / "notes" / "corpus" / "var-historique" / "code.py").read_text(encoding="utf-8") == code
    # Le manifeste embarque le code, pour la page Reading ouverte sans serveur.
    assert "np.percentile" in (site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8")


def test_le_code_python_est_reserve_aux_simulations(services):
    creer(services.corpus, "bayes")
    with pytest.raises(InvalidRequestError):
        texte(services.corpus, "bayes", "Texte", code="print(1)")


def test_le_texte_d_une_entree_inconnue_est_refuse(services):
    with pytest.raises(UnknownEntryError):
        texte(services.corpus, "inconnue", "Texte")


# ---------------------------------------------------------------- hypothèses et limites d'une formule
#
# Une formule porte deux textes en plus de sa formule : ses hypothèses et ses limites. Ils
# s'écrivent à part (comme le code d'une brique), mais s'affichent en deux petits blocs sous la
# formule, dans l'encadré de l'entrée : sur la page du corpus ET dans les fiches qui l'insèrent.

FORMULE = "$ c = S_0 N(d_1) - K e^(-r T) N(d_2) $"
HYPOTHESES = "- rendements log-normaux, $sigma$ constante\n- taux sans risque $r$ constant\n"
LIMITES = "- sous-estime les queues épaisses\n"


def avec_sections(corpus, entry_id, hypotheses=None, limites=None, source=FORMULE, who=BAPTISTE):
    """Raccourci : enregistre le texte d'une formule avec ses deux sections."""
    return corpus.save_text(entry_id, who, source, None, hypotheses, limites)


def hauteur(svg):
    """Hauteur d'une page SVG. Le texte y est converti en tracés : on ne peut pas y chercher un
    mot, mais un bloc de plus rend la page plus haute."""
    return float(re.search(r'<svg[^>]*\sheight="([\d.]+)', svg).group(1))


def rendu(site, entry_id):
    return (site / "notes" / "corpus" / entry_id / "page-1.svg").read_text(encoding="utf-8")


def test_une_formule_garde_ses_hypotheses_et_ses_limites(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes", titre="Black-Scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)

    dossier = site / "notes" / "corpus" / "black-scholes"
    # Chaque section est un fichier à part, à côté du texte.
    assert (dossier / "hypotheses.typ").read_text(encoding="utf-8") == HYPOTHESES
    assert (dossier / "limites.typ").read_text(encoding="utf-8") == LIMITES
    assert (dossier / "texte.typ").read_text(encoding="utf-8") == FORMULE
    # L'éditeur les relit par load_texts.
    fichiers = corpus.load_texts("black-scholes")
    assert (fichiers.source, fichiers.hypotheses, fichiers.limites) == (FORMULE, HYPOTHESES, LIMITES)
    # Une fiche qui insère l'entrée y trouvera les trois textes, chacun derrière sa fonction.
    generated = corpus_genere(site)
    assert 'hypotheses: () => include "corpus/black-scholes/hypotheses.typ"' in generated
    assert 'limites: () => include "corpus/black-scholes/limites.typ"' in generated


def test_les_blocs_agrandissent_l_encadre_sur_la_page_du_corpus(services, site):
    corpus = services.corpus
    creer(corpus, "sans-blocs")
    creer(corpus, "avec-blocs")
    avec_sections(corpus, "sans-blocs")
    avec_sections(corpus, "avec-blocs", HYPOTHESES, LIMITES)
    # Deux blocs de plus : la page est nettement plus haute (de l'ordre de 100 pt).
    assert hauteur(rendu(site, "avec-blocs")) > hauteur(rendu(site, "sans-blocs")) + 50


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
    fichier = site / "notes" / "corpus" / "black-scholes" / "limites.typ"
    avec = hauteur(rendu(site, "black-scholes"))
    assert fichier.exists()

    # Des espaces seuls comptent pour « vide » : le bloc disparaît, le fichier aussi.
    avec_sections(corpus, "black-scholes", HYPOTHESES, "  \n")
    assert not fichier.exists()
    assert hauteur(rendu(site, "black-scholes")) < avec
    assert "limites: none" in corpus_genere(site)
    assert "hypotheses: () => include" in corpus_genere(site)


def test_ne_pas_envoyer_une_section_la_laisse_telle_quelle(services, site):
    # Un client qui n'envoie pas « limites » (None) ne l'efface pas : seul un texte vide le fait.
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)
    avec_sections(corpus, "black-scholes", "- une seule hypothèse\n", None, who=MARIE)
    dossier = site / "notes" / "corpus" / "black-scholes"
    assert (dossier / "hypotheses.typ").read_text(encoding="utf-8") == "- une seule hypothèse\n"
    assert (dossier / "limites.typ").read_text(encoding="utf-8") == LIMITES


def test_la_copie_valide_garde_aussi_les_sections(services, site):
    # Les sections font partie du texte : quand une section casse la formule, les fiches gardent
    # la formule ET les sections qui compilaient.
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)
    with pytest.raises(TypstCompileError):
        avec_sections(corpus, "black-scholes", "$ sigmaa $", None, who=MARIE)
    copie = site / "notes" / "corpus" / "black-scholes" / "valide"
    assert (copie / "hypotheses.typ").read_text(encoding="utf-8") == HYPOTHESES
    assert (copie / "limites.typ").read_text(encoding="utf-8") == LIMITES
    assert '"corpus/black-scholes/valide/hypotheses.typ"' in corpus_genere(site)
    services.compiler.svg_pages(FICHE + '#entree("black-scholes")')


def test_les_sections_sont_reservees_aux_formules(services, site):
    corpus = services.corpus
    creer(corpus, "variance", type_="definition")
    with pytest.raises(InvalidRequestError) as raised:
        avec_sections(corpus, "variance", HYPOTHESES, None)
    assert raised.value.field == "hypotheses"
    assert not (site / "notes" / "corpus" / "variance" / "hypotheses.typ").exists()
    # Une section vide n'est pas un contenu : un client qui envoie toujours les deux champs passe.
    avec_sections(corpus, "variance", "", "", source="La dispersion autour de la moyenne.")


def test_changer_le_type_d_une_formule_ignore_ses_sections(services, site):
    # Les fichiers restent (rien n'est perdu si on se ravise), mais ne sont plus affichés.
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", HYPOTHESES, LIMITES)
    avant = hauteur(rendu(site, "black-scholes"))
    corpus.update_meta("black-scholes", EntryMeta("definition", "Black-Scholes"), BAPTISTE)
    assert hauteur(rendu(site, "black-scholes")) < avant
    assert (site / "notes" / "corpus" / "black-scholes" / "limites.typ").exists()
    assert "include" in corpus_genere(site)
    assert "limites.typ" not in corpus_genere(site)


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
    # Comme tout texte cassé : tout est enregistré ; l'entrée n'a jamais compilé, elle est absente des fiches.
    assert erreur.saved is True
    assert corpus.get("black-scholes").valid is False
    assert "corpus/black-scholes/" not in corpus_genere(site)
    assert erreur.extensions()["part"] == fautive


def test_une_erreur_sans_section_ne_porte_pas_de_partie(services):
    # Hors formule avec sections, la ligne se rapporte au seul texte : inutile d'ajouter la partie.
    creer(services.corpus, "bayes")
    with pytest.raises(TypstCompileError) as raised:
        texte(services.corpus, "bayes", "Ligne 1\n$ sigmaa $")
    assert (raised.value.part, raised.value.line) == (None, 2)
    assert "part" not in raised.value.extensions()


def test_une_section_cassee_puis_corrigee(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes")
    with pytest.raises(TypstCompileError):
        avec_sections(corpus, "black-scholes", "$ sigmaa $", None)
    # La fiche qui insère la formule compile toujours (dernier texte valide).
    services.compiler.svg_pages(FICHE + '#entree("black-scholes")')
    # Corrigée, la section revient dans les fiches.
    avec_sections(corpus, "black-scholes", "$ sigma $", None)
    assert corpus.get("black-scholes").valid is True
    assert '"corpus/black-scholes/hypotheses.typ"' in corpus_genere(site)


def test_une_section_peut_citer_une_autre_entree(services):
    corpus = services.corpus
    creer(corpus, "loi-normale", type_="definition", titre="Loi normale")
    creer(corpus, "black-scholes")
    avec_sections(corpus, "black-scholes", CITE + '- rendements suivant la #voir("loi-normale")\n', None)
    # La citation faite dans une section compte comme celles du texte : rétrolien, dépendants.
    assert corpus.get("black-scholes").cites == ("loi-normale",)
    assert corpus.dependents("loi-normale").entries == ("black-scholes",)
    # Donc renommer la loi normale recompile la formule, dont le bloc montre ce titre.
    _, rapport = corpus.update_meta("loi-normale", EntryMeta("definition", "Loi gaussienne"), BAPTISTE)
    assert rapport.rebuilt == ["corpus/black-scholes"]


def test_une_section_ne_peut_pas_inserer_d_entree(services, site):
    # Même garde que pour le texte : une section qui insérerait une entrée ferait une boucle.
    creer(services.corpus, "black-scholes")
    for section in ("hypotheses", "limites"):
        with pytest.raises(CorpusImportForbiddenError):
            avec_sections(services.corpus, "black-scholes", **{section: '#entree("black-scholes")'})
    assert not (site / "notes" / "corpus" / "black-scholes" / "texte.typ").exists()


def test_l_apercu_montre_les_sections_sans_rien_ecrire(services, site):
    corpus = services.corpus
    creer(corpus, "black-scholes")
    avant = sorted(p.name for p in (site / "notes" / "corpus" / "black-scholes").iterdir())
    sans = hauteur(corpus.preview("formule", "Black-Scholes", FORMULE)[0])
    avec = hauteur(corpus.preview("formule", "Black-Scholes", FORMULE, HYPOTHESES, LIMITES)[0])
    assert avec > sans + 50
    # Un aperçu n'est qu'un aperçu : aucun fichier.
    assert sorted(p.name for p in (site / "notes" / "corpus" / "black-scholes").iterdir()) == avant
    # Pour un autre type, les sections envoyées sont ignorées.
    definition = hauteur(corpus.preview("definition", "Variance", "Texte", HYPOTHESES, LIMITES)[0])
    assert definition == hauteur(corpus.preview("definition", "Variance", "Texte")[0])
    # Et une erreur d'aperçu désigne elle aussi le texte fautif.
    with pytest.raises(TypstCompileError) as raised:
        corpus.preview("formule", "Black-Scholes", FORMULE, HYPOTHESES, "$ sigmaa $")
    assert (raised.value.part, raised.value.line) == ("limites", 1)


# ---------------------------------------------------------------- API


def test_le_parcours_complet_par_l_api(api):
    # Créer l'entrée (le profil de la personne voyage avec chaque écriture, pour le journal).
    # Des readings envoyés par un ancien client sont ignorés : seules les fiches et les questions liées en donnent.
    status, _, body = api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Règle de Bayes", "readings": [12], **QUI})
    assert status == 201
    assert body["data"]["readings"] == []
    assert body["data"]["journal"][0]["creation"] is True
    assert body["links"]["update"]["method"] == "PUT"
    assert body["links"]["text"]["href"] == "/api/corpus/bayes/texte"

    # Pas encore de texte : 200 avec exists à False, et le lien pour l'écrire.
    status, _, body = api("GET", "/api/corpus/bayes/texte")
    assert (status, body["data"]["exists"]) == (200, False)
    assert body["links"]["save"]["href"] == "/api/corpus/bayes/texte"

    # Aperçu puis enregistrement.
    status, _, body = api("POST", "/api/compile/entry", {"type": "formule", "titre": "Règle de Bayes", "source": "$ x $"})
    assert status == 200 and body["data"]["pages"][0].startswith("<svg")
    status, _, body = api("PUT", "/api/corpus/bayes/texte", {"source": "$ x $", **QUI, "initials": "bd"})
    assert status == 200
    assert (body["data"]["hasText"], body["data"]["valid"]) == (True, True)
    assert body["data"]["pages"] == ["notes/corpus/bayes/page-1.svg"]
    # Création et texte dans la même séance ; les initiales sont mises en majuscules.
    assert [(s["initials"], s["saves"]) for s in body["data"]["journal"]] == [("BD", 2)]
    assert body["data"]["rebuild"] == {"rebuilt": [], "failed": [], "skipped": []}

    # La liste du corpus.
    status, _, body = api("GET", "/api/corpus")
    assert [e["id"] for e in body["data"]["entries"]] == ["bayes"]


def test_les_erreurs_du_corpus_par_l_api(api):
    status, _, body = api("GET", "/api/corpus/inconnue")
    assert (status, body["title"]) == (404, "ENTRY_NOT_FOUND")

    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes", **QUI})
    status, _, body = api("POST", "/api/corpus", {"id": "bayes", "type": "definition", "titre": "Autre", **QUI})
    assert (status, body["title"], body["existingType"]) == (409, "ENTRY_CONFLICT", "formule")

    status, _, body = api("PUT", "/api/corpus/bayes/texte", {"source": '#import "/_corpus.typ"', **QUI})
    assert (status, body["title"]) == (422, "CORPUS_IMPORT_FORBIDDEN")

    status, _, body = api("POST", "/api/corpus", {"id": "X", "type": "formule", "titre": "Bayes", **QUI})
    assert (status, body["field"]) == (422, "id")
    status, _, body = api("POST", "/api/corpus", {"id": "abc", "type": "lemme", "titre": "Bayes", **QUI})
    assert (status, body["field"]) == (422, "type")
    status, _, body = api("POST", "/api/corpus", {"id": "abc", "type": "formule", "titre": " ", **QUI})
    assert (status, body["field"]) == (422, "titre")


@pytest.mark.parametrize("profil, champ", [
    ({}, "author"),  # aucun profil : le journal ne saurait pas qui écrit
    ({**QUI, "author": "../evil"}, "author"),
    ({**QUI, "name": " "}, "name"),
    ({**QUI, "initials": "12"}, "initials"),
])
def test_une_ecriture_sans_profil_valide_est_refusee(api, profil, champ):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes", **QUI})
    status, _, body = api("PUT", "/api/corpus/bayes/texte", {"source": "$ x $", **profil})
    assert (status, body["field"]) == (422, champ)


def test_les_hypotheses_et_les_limites_par_l_api(api):
    api("POST", "/api/corpus", {"id": "black-scholes", "type": "formule", "titre": "Black-Scholes", **QUI})

    # Pas encore de texte : les deux sections sont à null, l'éditeur les voit vides.
    _, _, body = api("GET", "/api/corpus/black-scholes/texte")
    assert (body["data"]["hypotheses"], body["data"]["limites"]) == (None, None)

    # Aperçu avec les sections, puis enregistrement, puis relecture.
    status, _, body = api("POST", "/api/compile/entry", {"type": "formule", "titre": "BS", "source": FORMULE, "hypotheses": HYPOTHESES, "limites": LIMITES})
    assert status == 200 and body["data"]["pages"][0].startswith("<svg")
    status, _, _ = api("PUT", "/api/corpus/black-scholes/texte", {"source": FORMULE, "hypotheses": HYPOTHESES, "limites": LIMITES, **QUI})
    assert status == 200
    _, _, body = api("GET", "/api/corpus/black-scholes/texte")
    assert (body["data"]["source"], body["data"]["hypotheses"], body["data"]["limites"]) == (FORMULE, HYPOTHESES, LIMITES)

    # Une erreur dans une section : 422 habituel, avec la partie fautive et la ligne dans ce texte.
    status, _, body = api("PUT", "/api/corpus/black-scholes/texte", {"source": FORMULE, "hypotheses": HYPOTHESES, "limites": "ok\n$ sigmaa $", **QUI})
    assert (status, body["title"], body["part"], body["line"], body["saved"]) == (422, "TYPST_COMPILE_ERROR", "limites", 2, True)

    # Un champ qui n'est pas du texte est refusé avant tout.
    status, _, body = api("PUT", "/api/corpus/black-scholes/texte", {"source": FORMULE, "hypotheses": 3, **QUI})
    assert (status, body["field"]) == (422, "hypotheses")


# ---------------------------------------------------------------- suppression d'une entrée
#
# Supprimer une entrée retire aussi ses références, pour qu'aucune fiche ni entrée ne cite une
# entrée disparue (choix de Baptiste) : #voir devient le titre en texte simple, la phrase reste
# lisible ; #entree disparaît. Ces réécritures sont des modifications de la personne qui supprime.
# Une brique encore importée par du code est refusée.


def test_retirer_les_references_d_une_entree_dans_un_texte():
    texte_ = (
        'Utilise #voir("bayes") ici.\n'  # citation dans une phrase : remplacée par le titre
        '#entree("bayes")\n'  # insertion seule sur sa ligne : la ligne disparaît
        'avant #entree("bayes", auteur: "m(a)rie") après\n'  # parenthèse dans une chaîne : sautée
        '#voir("bayes-2")\n'  # une autre entrée au nom proche : intacte
    )
    nouveau, nombre = strip_references(texte_, "bayes", "Règle de *Bayes* [simple]")
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
    texte(corpus, "bayes", "$ P(A|B) $")
    rapport = corpus.delete("bayes", MARIE)
    assert rapport.failed == []
    # Le dossier entier part : texte, rendus, journal.
    assert not (site / "notes" / "corpus" / "bayes").exists()
    # Les fichiers générés ne la connaissent plus.
    for fichier in ("_corpus-titres.typ", "_corpus.typ", "corpus/index.js"):
        assert '"bayes"' not in (site / "notes" / fichier).read_text(encoding="utf-8"), fichier
    with pytest.raises(UnknownEntryError):
        corpus.get("bayes")


def test_supprimer_une_entree_retire_ses_references_des_fiches(services):
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes", titre="Règle de Bayes")
    texte(corpus, "bayes", "$ P(A|B) $")
    fiche(notes, 12, FICHE + 'Voir #voir("bayes").\n#entree("bayes")\nFin.', BAPTISTE)
    fiche(notes, 13, FICHE + "Rien à voir.", BAPTISTE)
    rapport = corpus.delete("bayes", MARIE)
    # La fiche qui l'utilisait est réécrite puis recompilée ; l'autre n'est pas touchée.
    assert rapport.rebuilt == ["notes/r12/fiche"]
    assert notes.load(NoteTarget(12)) == FICHE + "Voir Règle de Bayes.\nFin."
    assert notes.load(NoteTarget(13)) == FICHE + "Rien à voir."
    # Et elle compile, sans l'entrée disparue.
    services.compiler.svg_pages(notes.load(NoteTarget(12)))
    # La réécriture est une modification de Marie, qui a supprimé l'entrée : le journal le dit.
    assert [s.author for s in notes.journal(NoteTarget(12))] == ["baptiste", "marie"]
    assert [s.author for s in notes.journal(NoteTarget(13))] == ["baptiste"]


def test_supprimer_une_entree_retire_ses_references_des_autres_entrees(services, site):
    corpus = services.corpus
    creer(corpus, "loi-normale", type_="definition", titre="Loi normale")
    creer(corpus, "black-scholes")
    # Citée dans le texte et dans la section Hypothèses de la formule.
    avec_sections(corpus, "black-scholes", CITE + '- rendements selon la #voir("loi-normale")\n', None, source=CITE + 'Voir #voir("loi-normale").')
    rapport = corpus.delete("loi-normale", MARIE)
    dossier = site / "notes" / "corpus" / "black-scholes"
    assert (dossier / "hypotheses.typ").read_text(encoding="utf-8") == CITE + "- rendements selon la Loi normale\n"
    assert (dossier / "texte.typ").read_text(encoding="utf-8") == CITE + "Voir Loi normale."
    # L'entrée est recompilée une fois, reste valide, et ne cite plus rien.
    assert rapport.rebuilt == ["corpus/black-scholes"]
    entree = corpus.get("black-scholes")
    assert entree.valid
    assert entree.cites == ()
    assert [s.author for s in entree.journal] == ["baptiste", "marie"]


def test_supprimer_une_entree_nettoie_aussi_les_copies_valides(services, site):
    # Une fiche peut afficher la copie valide d'une entrée cassée : si cette copie cite l'entrée
    # supprimée, la fiche ne compilerait plus. La copie est donc nettoyée elle aussi.
    corpus = services.corpus
    creer(corpus, "loi-normale", type_="definition", titre="Loi normale")
    creer(corpus, "black-scholes")
    texte(corpus, "black-scholes", CITE + 'Voir #voir("loi-normale").')
    with pytest.raises(TypstCompileError):
        texte(corpus, "black-scholes", "Cassé #inconnu()")
    corpus.delete("loi-normale", BAPTISTE)
    copie = site / "notes" / "corpus" / "black-scholes" / "valide" / "texte.typ"
    assert copie.read_text(encoding="utf-8") == CITE + "Voir Loi normale."
    services.compiler.svg_pages(FICHE + '#entree("black-scholes")')


def test_une_fiche_qui_ne_compile_plus_est_rapportee_sans_bloquer(services):
    # La fiche contenait déjà sa propre erreur : elle est quand même réécrite, l'échec rapporté.
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    with pytest.raises(TypstCompileError):
        fiche(notes, 12, FICHE + '#voir("bayes")\n#inconnu()')
    rapport = corpus.delete("bayes", BAPTISTE)
    assert rapport.failed == [{"target": "notes/r12/fiche", "message": "unknown variable: inconnu"}]
    assert '#voir("bayes")' not in notes.load(NoteTarget(12))
    assert not corpus.exists("bayes")


def test_une_brique_encore_importee_ne_se_supprime_pas(services, site):
    corpus = services.corpus
    creer(corpus, "outils", type_="brique")
    texte(corpus, "outils", "Fonctions.", code="def f():\n    return 1\n")
    creer(corpus, "var-historique", type_="simulation")
    texte(corpus, "var-historique", "Simulation.", code="from briques.outils import f\nprint(f())\n")
    with pytest.raises(BrickInUseError) as raised:
        corpus.delete("outils", BAPTISTE)
    assert raised.value.imported_by == ["var-historique"]
    # Rien n'a bougé.
    assert (site / "notes" / "corpus" / "outils" / "code.py").exists()
    # Une fois l'import retiré, la suppression passe.
    texte(corpus, "var-historique", "Simulation.", code="print(1)\n")
    corpus.delete("outils", BAPTISTE)
    assert not corpus.exists("outils")


def test_supprimer_une_entree_inconnue_donne_404(services):
    with pytest.raises(UnknownEntryError):
        services.corpus.delete("inconnue", BAPTISTE)


def test_la_suppression_par_l_api(api):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes", **QUI})
    api("PUT", "/api/notes/12", {"source": FICHE + '#voir("bayes")', **QUI})
    # Supprimer réécrit des fiches : la requête dit qui le fait, pour leur journal.
    status, _, body = api("DELETE", "/api/corpus/bayes", {})
    assert (status, body["field"]) == (422, "author")
    status, _, body = api("DELETE", "/api/corpus/bayes", QUI)
    assert status == 200
    assert body["data"]["deleted"] == "bayes"
    assert body["data"]["rebuild"]["rebuilt"] == ["notes/r12/fiche"]
    status, _, body = api("DELETE", "/api/corpus/bayes", QUI)
    assert (status, body["title"]) == (404, "ENTRY_NOT_FOUND")
    status, _, body = api("GET", "/api/corpus")
    assert body["data"]["entries"] == []


def test_supprimer_une_brique_importee_par_l_api_donne_409(api, services):
    creer(services.corpus, "outils", type_="brique", titre="Outils")
    texte(services.corpus, "outils", "Texte.", code="def f():\n    return 1\n")
    creer(services.corpus, "sim", type_="simulation", titre="Sim")
    texte(services.corpus, "sim", "Texte.", code="import briques.outils\n")
    status, _, body = api("DELETE", "/api/corpus/outils", QUI)
    assert (status, body["title"], body["importedBy"]) == (409, "BRICK_IN_USE", ["sim"])


# ---------------------------------------------------------------- questions liées à une entrée
#
# On relie des questions AnalystPrep aux entrées du corpus depuis la page des questions, pour
# retrouver les questions d'une ou plusieurs entrées et s'en faire des séries. Le lien vit dans
# entree.json : partagé comme le reste du corpus (git). Depuis le 2026-10-07 (choix de Baptiste),
# il rattache l'entrée au reading de la question, comme une citation dans une fiche ; les deux
# origines restent distinguées (noteReadings, questionReadings).


def test_lier_une_question_l_ecrit_dans_l_entree_et_le_manifeste(services, site):
    corpus = services.corpus
    creer(corpus, "bayes")
    entree = corpus.link_question("bayes", "315", 12, linked=True)
    assert entree.questions == (("315", 12),)
    meta = json.loads((site / "notes" / "corpus" / "bayes" / "entree.json").read_text(encoding="utf-8"))
    assert meta["questions"] == [{"id": "315", "reading": 12}]
    # Le manifeste (pages ouvertes sans serveur) porte les liens : la page Corpus et les séries les lisent.
    assert manifeste(site)["bayes"]["questions"] == [{"id": "315", "reading": 12}]


def test_les_liens_sont_tries_et_sans_doublon(services):
    corpus = services.corpus
    creer(corpus, "bayes")
    for question, reading in (("402", 13), ("315", 12), ("90", 12), ("315", 12)):
        entree = corpus.link_question("bayes", question, reading, linked=True)
    # Par reading puis par numéro (90 avant 315, pas l'ordre alphabétique) ; lier deux fois ne double pas.
    assert entree.questions == (("90", 12), ("315", 12), ("402", 13))


def test_delier_une_question(services, site):
    corpus = services.corpus
    creer(corpus, "bayes")
    corpus.link_question("bayes", "315", 12, linked=True)
    corpus.link_question("bayes", "402", 13, linked=True)
    assert corpus.link_question("bayes", "315", 0, linked=False).questions == (("402", 13),)
    # Délier une question non liée ne fait rien (idempotent).
    assert corpus.link_question("bayes", "999", 0, linked=False).questions == (("402", 13),)
    # Plus aucun lien : la clé disparaît du fichier, qui retrouve sa forme d'avant.
    corpus.link_question("bayes", "402", 0, linked=False)
    meta = json.loads((site / "notes" / "corpus" / "bayes" / "entree.json").read_text(encoding="utf-8"))
    assert "questions" not in meta


def test_un_lien_rattache_l_entree_au_reading_de_la_question(services):
    corpus = services.corpus
    creer(corpus, "bayes")
    corpus.link_question("bayes", "315", 12, linked=True)
    entree = corpus.get("bayes")
    # Une question appartient à un reading : la lier à l'entrée dit que l'entrée sert à ce reading.
    assert entree.readings == (12,)
    assert (entree.note_readings, entree.question_readings) == ((), (12,))
    # Délier la question retire le rattachement s'il ne venait que d'elle.
    corpus.link_question("bayes", "315", 0, linked=False)
    assert corpus.get("bayes").readings == ()


def test_les_readings_viennent_des_fiches_et_des_questions_sans_se_confondre(services, site):
    # Fiche du reading 12, questions des readings 12 et 30 : l'entrée appartient à 12 et 30 ;
    # le manifeste dit d'où vient chacun (pour les filtres « pas encore dans une fiche », etc.).
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    fiche(notes, 12, FICHE + '#voir("bayes")')
    corpus.link_question("bayes", "315", 12, linked=True)
    corpus.link_question("bayes", "900", 30, linked=True)
    entree = corpus.get("bayes")
    assert entree.readings == (12, 30)
    assert entree.note_readings == (12,)
    assert entree.question_readings == (12, 30)
    m = manifeste(site)["bayes"]
    assert (m["readings"], m["noteReadings"], m["questionReadings"]) == ([12, 30], [12], [12, 30])


def test_les_liens_survivent_aux_modifications_de_l_entree(services):
    # Changer le titre ou écrire le texte réécrit entree.json : les liens doivent rester.
    corpus = services.corpus
    creer(corpus, "bayes")
    corpus.link_question("bayes", "315", 12, linked=True)
    corpus.update_meta("bayes", EntryMeta("formule", "Règle de Bayes"), BAPTISTE)
    texte(corpus, "bayes", "$ P(A|B) $")
    assert corpus.get("bayes").questions == (("315", 12),)


def test_lier_et_delier_par_l_api(api):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes", **QUI})
    status, _, body = api("PUT", "/api/corpus/bayes/questions/315", {"reading": 12})
    assert status == 200
    assert body["data"]["questions"] == [{"id": "315", "reading": 12}]
    # La liste du corpus porte aussi les liens (le menu des questions s'en sert pour Lier / Délier).
    _, _, body = api("GET", "/api/corpus")
    assert body["data"]["entries"][0]["questions"] == [{"id": "315", "reading": 12}]
    status, _, body = api("DELETE", "/api/corpus/bayes/questions/315", {})
    assert (status, body["data"]["questions"]) == (200, [])


@pytest.mark.parametrize("chemin, corps, champ", [
    ("/api/corpus/bayes/questions/abc", {"reading": 12}, "question"),   # pas un identifiant
    ("/api/corpus/bayes/questions/315", {"reading": 63}, "reading"),    # reading hors programme
    ("/api/corpus/bayes/questions/315", {"reading": "12"}, "reading"),  # texte au lieu d'un entier
    ("/api/corpus/bayes/questions/315", {}, "reading"),                 # reading manquant
])
def test_un_lien_mal_forme_est_refuse(api, chemin, corps, champ):
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes", **QUI})
    status, _, body = api("PUT", chemin, corps)
    assert (status, body["field"]) == (422, champ)


def test_lier_a_une_entree_inconnue_donne_404(api):
    status, _, body = api("PUT", "/api/corpus/inconnue/questions/315", {"reading": 12})
    assert (status, body["title"]) == (404, "ENTRY_NOT_FOUND")


# ---------------------------------------------------------------- readings tirés des fiches


def test_les_readings_d_une_entree_sont_ceux_des_fiches_qui_l_utilisent(services):
    # C'est la fiche d'un reading qui rattache l'entrée à ce reading, qu'elle la cite (#voir) ou
    # l'insère (#entree).
    corpus, notes = services.corpus, services.notes
    creer(corpus, "bayes")
    texte(corpus, "bayes", "Texte.")
    fiche(notes, 13, FICHE + '#entree("bayes")', MARIE)
    fiche(notes, 12, FICHE + '#voir("bayes")', BAPTISTE)
    entry = corpus.get("bayes")
    assert entry.readings == (12, 13)
    assert [n.reading for n in entry.used_by] == [12, 13]


def test_une_citation_par_une_autre_entree_ne_rattache_pas(services):
    # La fiche QA-1 cite « bayes », qui cite « proba-conditionnelle » : seule « bayes » reçoit
    # le reading 12, sinon tout finirait rattaché à tout.
    corpus, notes = services.corpus, services.notes
    creer(corpus, "proba-conditionnelle", type_="definition")
    creer(corpus, "bayes")
    texte(corpus, "bayes", CITE + '#voir("proba-conditionnelle")')
    fiche(notes, 12, FICHE + '#voir("bayes")')
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
    notes.save(NoteTarget(12), "= Fiche", BAPTISTE)
    with pytest.raises(TypstCompileError):
        notes.save(NoteTarget(12), "#inconnu()", BAPTISTE)
    assert appels == ["ok", "ok"]


def test_enregistrer_une_fiche_met_a_jour_les_readings_du_corpus(api, site):
    # Le manifeste du corpus (lu par les pages sans serveur) suit chaque enregistrement de fiche :
    # ajouter la citation rattache l'entrée, la retirer la détache.
    api("POST", "/api/corpus", {"id": "bayes", "type": "formule", "titre": "Bayes", **QUI})

    api("PUT", "/api/notes/12", {"source": FICHE + '#voir("bayes")', **QUI})
    assert manifeste(site)["bayes"]["readings"] == [12]
    assert manifeste(site)["bayes"]["usedBy"] == [{"reading": 12}]
    _, _, body = api("GET", "/api/corpus/bayes")
    assert body["data"]["readings"] == [12]

    # Même une fiche qui ne compile pas a son texte écrit : le rattachement suit le texte.
    api("PUT", "/api/notes/12", {"source": FICHE + "Plus de citation.\n#inconnu()", **QUI})
    assert manifeste(site)["bayes"]["readings"] == []
