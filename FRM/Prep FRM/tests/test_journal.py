"""Tests du journal des modifications (backend/journal.py).

Les fiches et les entrées du corpus sont communes depuis le 2026-10-07 : le journal garde qui les
a créées et qui les a modifiées, quand, pour avoir des données sur les interactions entre profils
(les textes eux-mêmes, c'est git qui les garde). On vérifie :
1. le regroupement en séances (une fiche s'enregistre toute seule pendant la frappe) ;
2. la création, notée une seule fois ;
3. la tolérance aux fusions git (merge=union) : lignes en double ou abîmées.
"""
from backend import journal
from backend.journal import SESSION_GAP_MS, Contributor

BAPTISTE = Contributor("baptiste", "Baptiste Durand", "BD")
MARIE = Contributor("marie", "Marie Martin", "MM")
T0 = 1_759_240_000_000  # une date fixe, en millisecondes


def resume(dossier):
    """(auteur, début, fin, enregistrements, création) de chaque séance : de quoi comparer en une ligne."""
    return [(s.author, s.start, s.end, s.saves, s.creation) for s in journal.read(dossier)]


def test_sans_journal_la_liste_est_vide(tmp_path):
    # Une fiche ou une entrée d'avant le journal n'a pas de fichier : ce n'est pas une erreur.
    assert journal.read(tmp_path) == []


def test_des_enregistrements_rapproches_forment_une_seance(tmp_path):
    # Trois enregistrements de Baptiste à quelques minutes d'écart : une seule ligne, prolongée.
    journal.record(tmp_path, BAPTISTE, T0, creation=True)
    journal.record(tmp_path, BAPTISTE, T0 + 60_000)
    journal.record(tmp_path, BAPTISTE, T0 + 20 * 60_000)
    assert resume(tmp_path) == [("baptiste", T0, T0 + 20 * 60_000, 3, True)]
    # Le fichier n'a bien qu'une ligne : c'est elle qui a été prolongée.
    assert len((tmp_path / "journal.jsonl").read_text(encoding="utf-8").splitlines()) == 1


def test_une_pause_ou_une_autre_personne_ouvre_une_nouvelle_seance(tmp_path):
    journal.record(tmp_path, BAPTISTE, T0, creation=True)
    # Marie passe entre-temps : sa propre séance, même si Baptiste vient d'écrire.
    journal.record(tmp_path, MARIE, T0 + 60_000)
    # Baptiste revient : sa dernière séance n'est plus la dernière du texte, il en ouvre une autre.
    journal.record(tmp_path, BAPTISTE, T0 + 2 * 60_000)
    # Puis il revient après une longue pause : encore une nouvelle séance.
    journal.record(tmp_path, BAPTISTE, T0 + 2 * 60_000 + SESSION_GAP_MS)
    assert [(a, n, c) for a, _, _, n, c in resume(tmp_path)] == [
        ("baptiste", 1, True),
        ("marie", 1, False),
        ("baptiste", 1, False),
        ("baptiste", 1, False),
    ]


def test_le_premier_enregistrement_est_une_creation(tmp_path):
    # Même sans le dire (le premier enregistrement d'une fiche la crée), la première ligne l'est.
    journal.record(tmp_path, MARIE, T0)
    assert resume(tmp_path) == [("marie", T0, T0, 1, True)]


def test_le_nom_et_les_initiales_suivent_le_profil(tmp_path):
    # Si la personne change l'orthographe de son nom en cours de séance, la ligne prend le dernier.
    journal.record(tmp_path, BAPTISTE, T0, creation=True)
    journal.record(tmp_path, Contributor("baptiste", "Baptiste D.", "BD"), T0 + 1000)
    assert journal.read(tmp_path)[0].name == "Baptiste D."


def test_les_lignes_d_une_fusion_git_sont_relues_proprement(tmp_path):
    # Après une fusion « merge=union », le fichier peut contenir une ligne en double, une ligne
    # abîmée et des lignes dans le désordre : rien de cela ne doit faire échouer la lecture.
    journal.record(tmp_path, BAPTISTE, T0, creation=True)
    ligne = (tmp_path / "journal.jsonl").read_text(encoding="utf-8")
    marie = '{"auteur": "marie", "nom": "Marie Martin", "initiales": "MM", "debut": %d, "fin": %d, "enregistrements": 2}\n' % (T0 - 5000, T0 - 4000)
    (tmp_path / "journal.jsonl").write_text(ligne + "<<<<<<< pas du json\n" + ligne + marie + '{"auteur": "x"}\n', encoding="utf-8")
    # Doublon et lignes illisibles ignorés ; tri par date de début.
    assert [(a, n) for a, _, _, n, _ in resume(tmp_path)] == [("marie", 2), ("baptiste", 1)]
