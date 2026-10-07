"""Tests des écritures de fichiers du serveur (backend/files.py).

Bug vécu le 2026-10-07 : enregistrer une entrée échouait par moments avec « OSError [Errno 22]
Invalid argument » sur un rendu SVG. Sous Windows, un fichier qu'un autre programme garde mappé en
mémoire ne peut pas être réécrit ; git le fait en relisant les fichiers modifiés, et l'éditeur
lance git juste après chaque écriture. L'écriture réussit quelques instants plus tard : le serveur
doit donc réessayer au lieu d'échouer.
"""
import subprocess
import sys

import pytest

from backend import files
from backend.files import remove, write_atomic


def tenir_mappe(chemin, secondes):
    """Lance un autre processus qui garde le fichier mappé en mémoire, comme git le fait.
    Rend la main une fois le mapping posé."""
    code = (
        "import mmap, sys, time\n"
        f"f = open({str(chemin)!r}, 'rb')\n"
        "m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)\n"
        "print('ok', flush=True)\n"
        f"time.sleep({secondes})\n"
    )
    processus = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    processus.stdout.readline()  # attend que le fichier soit effectivement mappé
    return processus


@pytest.mark.skipif(sys.platform != "win32", reason="le verrou des fichiers mappés est propre à Windows")
def test_une_ecriture_attend_qu_un_autre_programme_relache_le_fichier(tmp_path):
    rendu = tmp_path / "baptiste-1.svg"
    rendu.write_text("<svg>ancien</svg>" * 50, encoding="utf-8")
    # Sans précaution, l'écriture échoue tant que le fichier est mappé : c'est le bug d'origine.
    processus = tenir_mappe(rendu, 0.4)
    with pytest.raises(OSError):
        rendu.write_text("<svg>direct</svg>", encoding="utf-8")
    # write_atomic réessaie : elle réussit dès que l'autre programme a relâché le fichier.
    write_atomic(rendu, "<svg>nouveau</svg>")
    processus.wait()
    assert rendu.read_text(encoding="utf-8") == "<svg>nouveau</svg>"
    # Aucun fichier temporaire ne traîne après coup.
    assert [p.name for p in tmp_path.iterdir()] == ["baptiste-1.svg"]


@pytest.mark.skipif(sys.platform != "win32", reason="le verrou des fichiers mappés est propre à Windows")
def test_une_suppression_attend_aussi(tmp_path):
    ancienne_page = tmp_path / "baptiste-2.svg"
    ancienne_page.write_text("<svg/>" * 50, encoding="utf-8")
    processus = tenir_mappe(ancienne_page, 0.4)
    remove(ancienne_page)
    processus.wait()
    assert not ancienne_page.exists()


def test_un_blocage_qui_dure_finit_par_remonter_l_erreur(monkeypatch):
    # Au-delà des essais prévus, l'erreur remonte : le serveur répond 500 STORAGE_ERROR comme avant.
    monkeypatch.setattr(files, "RETRY_DELAYS", (0, 0))
    essais = []

    def toujours_bloque():
        essais.append(1)
        raise OSError(22, "Invalid argument")

    with pytest.raises(OSError):
        files.retrying(toujours_bloque)
    assert len(essais) == 3  # deux réessais plus le dernier essai


def test_un_fichier_absent_n_est_pas_reessaye(monkeypatch):
    # Un fichier introuvable n'est pas un verrou passager : inutile d'attendre.
    essais = []

    def absent():
        essais.append(1)
        raise FileNotFoundError("absent")

    with pytest.raises(FileNotFoundError):
        files.retrying(absent)
    assert len(essais) == 1
