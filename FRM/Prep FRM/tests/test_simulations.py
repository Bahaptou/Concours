"""Tests de l'exécution du Python (simulations et briques du corpus).

Le code tourne dans un processus Python séparé, dans un dossier temporaire. On vérifie :
1. ce que l'utilisateur voit : sortie, erreur avec sa ligne, figures, limite de temps ;
2. les briques : importables par les simulations ; chaque brique a un seul code, commun ;
3. qu'une erreur dans le code est un résultat (200), pas une erreur de l'API.
"""
import json

import pytest

from backend.corpus import EntryMeta
from backend.errors import InvalidRequestError
from backend.journal import Contributor

BAPTISTE = Contributor("baptiste", "Baptiste Durand", "BD")
MARIE = Contributor("marie", "Marie Martin", "MM")


def brique(corpus, entry_id, code, who=BAPTISTE, create=True):
    """Raccourci : crée la brique (si besoin) et enregistre son code commun, écrit par `who`."""
    if create:
        corpus.create(entry_id, EntryMeta("brique", entry_id), BAPTISTE)
    corpus.save_text(entry_id, who, "Une brique.", code)


# ---------------------------------------------------------------- ce que l'utilisateur voit


def test_la_sortie_du_code_est_renvoyee(services):
    result = services.simulations.run("import numpy as np\nprint(np.arange(3).sum())")
    # numpy vient du projet uv : les simulations ont leurs bibliothèques sans rien installer.
    assert result.ok is True
    assert result.stdout.strip() == "3"
    assert result.error is None
    assert result.duration_ms > 0


def test_une_erreur_donne_son_type_son_message_et_sa_ligne(services):
    result = services.simulations.run("x = 1\ny = 2\nprint(x / 0)\n")
    assert result.ok is False
    assert result.error == {"type": "ZeroDivisionError", "message": "division by zero", "line": 3}
    # La trace ne montre que le code de l'utilisateur : ni le lanceur, ni le dossier temporaire.
    assert "main.py" in result.stderr
    assert "_runner" not in result.stderr and "runpy" not in result.stderr
    assert "prep-frm-run-" not in result.stderr


def test_une_erreur_de_syntaxe_donne_aussi_sa_ligne(services):
    result = services.simulations.run("print('ok')\nif True\n    pass\n")
    assert (result.error["type"], result.error["line"]) == ("SyntaxError", 2)


def test_les_figures_matplotlib_sont_recuperees(services):
    # Aucun plt.show() ni savefig à écrire : toute figure ouverte à la fin est renvoyée en PNG.
    code = "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.figure()\nplt.hist([1, 2, 2, 3])\n"
    result = services.simulations.run(code)
    assert result.ok is True
    assert len(result.figures) == 2
    assert all(f.startswith("data:image/png;base64,") for f in result.figures)


def test_un_code_trop_long_est_arrete(services):
    result = services.simulations.run("while True:\n    pass\n", timeout=1)
    assert result.ok is False
    assert result.timed_out is True
    assert result.error["type"] == "Timeout"


# ---------------------------------------------------------------- briques


def test_une_simulation_importe_une_brique(services):
    brique(services.corpus, "donnees-aleatoires", "def generate_random_data(n):\n    return list(range(n))\n")
    code = "from briques.donnees_aleatoires import generate_random_data\nprint(len(generate_random_data(100)))"
    result = services.simulations.run(code)
    assert result.stdout.strip() == "100"
    assert [(b.entry_id, b.module) for b in result.bricks] == [("donnees-aleatoires", "donnees_aleatoires")]


def test_une_brique_a_un_seul_code_commun(services):
    # Les briques sont à tout le monde : quand Marie modifie le code, toutes les simulations
    # prennent le sien, quel que soit leur auteur.
    corpus = services.corpus
    brique(corpus, "valeur", "VALEUR = 'baptiste'\n")
    brique(corpus, "valeur", "VALEUR = 'marie'\n", who=MARIE, create=False)
    result = services.simulations.run("from briques.valeur import VALEUR\nprint(VALEUR)")
    assert result.stdout.strip() == "marie"


def test_seules_les_briques_importees_sont_rapportees_meme_indirectement(services):
    corpus = services.corpus
    brique(corpus, "base", "def un():\n    return 1\n")
    brique(corpus, "derivee", "from briques.base import un\ndef deux():\n    return un() + 1\n")
    brique(corpus, "inutilisee", "X = 0\n")
    result = services.simulations.run("from briques.derivee import deux\nprint(deux())")
    assert result.stdout.strip() == "2"
    assert sorted(b.entry_id for b in result.bricks) == ["base", "derivee"]


def test_l_identifiant_d_une_brique_commence_par_une_lettre(services):
    # « 2-actifs » donnerait le module briques.2_actifs, qu'aucun import Python n'accepte.
    with pytest.raises(InvalidRequestError) as raised:
        services.corpus.create("2-actifs", EntryMeta("brique", "Deux actifs"), BAPTISTE)
    assert raised.value.field == "id"


def test_les_imports_de_briques_sont_releves_dans_le_corpus(services, site):
    corpus = services.corpus
    brique(corpus, "donnees-aleatoires", "def f():\n    return 1\n")
    corpus.create("var-historique", EntryMeta("simulation", "VaR historique"), BAPTISTE)
    corpus.save_text("var-historique", BAPTISTE, "Texte.", "from briques.donnees_aleatoires import f\n")
    assert corpus.get("var-historique").imports == ("donnees-aleatoires",)
    assert corpus.importers("donnees-aleatoires") == ["var-historique"]
    manifest = (site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8")
    payload = json.loads(manifest.split("FRM.registerCorpus(", 1)[1].rsplit(");", 1)[0])
    assert payload["donnees-aleatoires"]["importedBy"] == ["var-historique"]


# ---------------------------------------------------------------- API


def test_l_api_execute_et_renvoie_un_resultat_meme_en_erreur(api):
    status, _, body = api("POST", "/api/run", {"code": "print('bonjour')"})
    assert status == 200
    assert (body["data"]["ok"], body["data"]["stdout"].strip()) == (True, "bonjour")
    # Une erreur dans le code est un résultat à montrer, pas une erreur de l'API.
    status, _, body = api("POST", "/api/run", {"code": "1/0"})
    assert (status, body["data"]["ok"], body["data"]["error"]["type"]) == (200, False, "ZeroDivisionError")


@pytest.mark.parametrize("payload, field", [
    ({"code": "x", "timeout": 0}, "timeout"),
    ({"code": "x", "timeout": 301}, "timeout"),
    ({"code": "x", "timeout": True}, "timeout"),
    ({"timeout": 30}, "code"),
])
def test_l_api_refuse_une_demande_mal_formee(api, payload, field):
    status, _, body = api("POST", "/api/run", payload)
    assert (status, body["title"], body["field"]) == (422, "INVALID_REQUEST_PAYLOAD", field)


# ---------------------------------------------------------------- relecture WTF4 : sécurité


def test_le_code_ne_voit_pas_les_variables_du_serveur(services, monkeypatch):
    # Une clé ajoutée un jour à l'environnement du serveur (pour un autre service) ne doit pas
    # être lisible par une simulation : le sous-processus reçoit un environnement minimal.
    monkeypatch.setenv("CLE_SECRETE_DE_TEST", "ne-pas-fuiter")
    result = services.simulations.run("import os\nprint(os.environ.get('CLE_SECRETE_DE_TEST'))")
    assert result.stdout.strip() == "None"


def _vivant(pid: int) -> bool:
    """Le processus `pid` tourne-t-il encore ? (sans dépendance : tasklist sous Windows)."""
    import os
    import subprocess
    if os.name == "nt":
        sortie = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in sortie
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def test_le_depassement_de_temps_arrete_aussi_les_processus_lances_par_le_code(services):
    # Une simulation qui lance elle-même un processus (ici un Python qui dort 2 minutes) :
    # à la fin du temps, tout l'arbre doit être arrêté, pas seulement le premier processus.
    import time
    code = (
        "import subprocess, sys\n"
        "enfant = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\n"
        "print(enfant.pid, flush=True)\n"
        "while True:\n"
        "    pass\n"
    )
    result = services.simulations.run(code, timeout=3)
    assert result.timed_out is True
    pid = int(result.stdout.split()[0])
    time.sleep(0.5)  # laisser au système le temps de retirer le processus tué
    assert not _vivant(pid)


def test_une_figure_geante_est_reduite(services):
    # figsize de 100 pouces : à 110 dpi, 11 000 pixels de côté. Le côté est ramené à 3 000 au plus.
    import base64
    import struct
    code = "import matplotlib.pyplot as plt\nplt.figure(figsize=(100, 20))\nplt.plot([1, 2])\n"
    result = services.simulations.run(code)
    png = base64.b64decode(result.figures[0].split(",", 1)[1])
    largeur, hauteur = struct.unpack(">II", png[16:24])  # en-tête IHDR du PNG
    assert max(largeur, hauteur) <= 3100  # bbox_inches="tight" peut ajuster de quelques pixels

