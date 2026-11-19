"""Tests de l'historique des textes communs, lu dans git (backend/history.py).

Choix de Baptiste (2026-11-19) : les fiches et les entrées sont des fichiers Markdown qu'Obsidian
modifie aussi ; un journal écrit par le site manquerait ces modifications. git les voit toutes, et
chacun commite sous son nom. On vérifie :
1. le créateur (premier commit) et les contributeurs, dans la forme qu'attendent les pages ;
2. les anciens chemins (avant le passage au Markdown) comptent pour le même texte ;
3. une modification pas encore commitée est signalée ;
4. sans dépôt git, l'historique est vide et rien ne casse.
"""
from backend.corpus import EntryMeta
from backend.history import HistoryService, initials, slug, text_of
from backend.notes import NoteTarget
from tests.conftest import git


def test_les_chemins_des_textes_sont_reconnus():
    # Nouveaux chemins et anciens (Typst), pour garder l'historique d'avant la migration.
    assert text_of("corpus/bayes.md") == ("entry", "bayes")
    assert text_of("corpus/bayes/texte.typ") == ("entry", "bayes")
    assert text_of("fiches/r12.md") == ("note", "12")
    assert text_of("r12/fiche.typ") == ("note", "12")
    # Les fichiers générés et le reste ne sont pas des textes.
    assert text_of("corpus/index.js") is None
    assert text_of("images/courbe.png") is None


def test_initiales_et_identifiant_tires_du_nom_git():
    assert (initials("Baptiste DURAND"), slug("Baptiste DURAND")) == ("BD", "baptiste-durand")
    assert (initials("Cécile Diana"), slug("Cécile Diana")) == ("CD", "cecile-diana")
    # Un pseudonyme donne des initiales sans rapport (CP) : à corriger dans git config user.name.
    assert initials("cecilediana97-prog") == "CP"


def test_le_createur_et_les_contributeurs_viennent_des_commits(git_site, services):
    # Baptiste crée l'entrée, Cécile la modifie : deux commits, deux auteurs.
    services.corpus.create("bayes", EntryMeta("formule", "Règle de Bayes"))
    git(git_site, "add", "-A")
    git(git_site, "commit", "-q", "-m", "création", author="Baptiste Durand")
    services.corpus.save_text("bayes", "Texte.", None)
    git(git_site, "add", "-A")
    git(git_site, "commit", "-q", "-m", "texte", author="Cécile Diana")

    sessions = services.corpus.get("bayes").journal
    # Même forme que l'ancien journal : les pages gardent leur affichage et leurs filtres.
    assert [(s["author"], s["initials"], s["creation"]) for s in sessions] == [("baptiste-durand", "BD", True), ("cecile-diana", "CD", False)]
    assert services.corpus.get("bayes").modified is False


def test_les_anciens_chemins_comptent_pour_le_meme_texte(git_site, services):
    # Avant la migration, l'entrée vivait dans corpus/bayes/texte.typ ; Baptiste l'avait créée.
    ancien = git_site / "notes" / "corpus" / "bayes" / "texte.typ"
    ancien.parent.mkdir(parents=True)
    ancien.write_text("$ P(A) $", encoding="utf-8")
    git(git_site, "add", "-A")
    git(git_site, "commit", "-q", "-m", "typst", author="Baptiste Durand")
    # Cécile fait la migration : l'ancien dossier part, le fichier Markdown arrive.
    git(git_site, "rm", "-q", "-r", "notes/corpus/bayes")
    services.corpus.create("bayes", EntryMeta("formule", "Règle de Bayes"))
    git(git_site, "add", "-A")
    git(git_site, "commit", "-q", "-m", "markdown", author="Cécile Diana")
    # Le créateur reste Baptiste : l'historique d'avant la migration n'est pas perdu.
    sessions = services.corpus.get("bayes").journal
    assert [(s["name"], s["creation"]) for s in sessions] == [("Baptiste Durand", True), ("Cécile Diana", False)]


def test_une_modification_pas_encore_commitee_est_signalee(git_site, services):
    services.notes.save(NoteTarget(12), "## Fiche\n")
    git(git_site, "add", "-A")
    git(git_site, "commit", "-q", "-m", "fiche")
    snapshot = services.history.snapshot()
    assert snapshot.is_modified("note", 12) is False
    # Modifiée dans Obsidian (ou par le site) sans commit : signalée, auteur encore inconnu.
    (git_site / "notes" / "fiches" / "r12.md").write_text("## Fiche modifiée\n", encoding="utf-8")
    snapshot = services.history.snapshot()
    assert snapshot.is_modified("note", 12) is True
    assert len(snapshot.sessions("note", 12)) == 1


def test_sans_depot_git_l_historique_est_vide(site, services):
    # Le dossier de test n'est pas un dépôt : rien ne casse, l'historique est simplement vide.
    services.corpus.create("bayes", EntryMeta("formule", "Règle de Bayes"))
    assert services.corpus.get("bayes").journal == ()
    assert HistoryService(site / "absent").snapshot().commits == {}
