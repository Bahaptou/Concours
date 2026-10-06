"""Tests des boutons de maths ajoutés depuis les éditeurs (notes/_outils-maths.json).

Les boutons de base de la barre « Mode maths » sont dans le code (toolbar.js) ; ceux-ci s'ajoutent
depuis le navigateur et sont rangés dans le projet : partagés entre nous et gardés par git.
"""
import json

import pytest

from backend.errors import InvalidRequestError
from backend.math_tools import UnknownMathToolError


def test_sans_bouton_ajoute_la_liste_est_vide(services, site):
    # Le fichier n'existe pas tant qu'on n'a rien ajouté : pas d'erreur pour autant.
    assert services.math_tools.list() == []
    assert not (site / "notes" / "_outils-maths.json").exists()


def test_ajouter_un_bouton_l_ecrit_dans_le_projet(services, site):
    outil = services.math_tools.add("Cov", 'op("Cov")(X, Y)', "X, Y")
    assert (outil.label, outil.typst, outil.select) == ("Cov", 'op("Cov")(X, Y)', "X, Y")
    fichier = json.loads((site / "notes" / "_outils-maths.json").read_text(encoding="utf-8"))
    assert fichier == {"tools": [{"id": outil.id, "label": "Cov", "typst": 'op("Cov")(X, Y)', "select": "X, Y"}]}


def test_les_boutons_gardent_leur_ordre_d_ajout_et_un_identifiant_unique(services):
    # Deux ajouts dans la même milliseconde ne doivent pas partager d'identifiant.
    ids = [services.math_tools.add(f"B{i}", f"x_{i}", None).id for i in range(5)]
    assert len(set(ids)) == 5
    assert [t.label for t in services.math_tools.list()] == ["B0", "B1", "B2", "B3", "B4"]


def test_une_partie_a_selectionner_vide_vaut_aucune(services):
    assert services.math_tools.add("Cov", 'op("Cov")', "  ").select is None


@pytest.mark.parametrize("label, typst, select, champ", [
    ("", "x", None, "label"),                      # libellé vide
    ("x" * 17, "x", None, "label"),                # libellé trop long pour un bouton
    ("Cov", " ", None, "typst"),                   # rien à insérer
    ("Cov", "x" * 201, None, "typst"),             # trop long
    ("Cov", 'op("Cov")(X, Y)', "Z", "select"),     # la partie à sélectionner doit exister
])
def test_un_bouton_mal_forme_est_refuse(services, label, typst, select, champ):
    with pytest.raises(InvalidRequestError) as raised:
        services.math_tools.add(label, typst, select)
    assert raised.value.field == champ
    assert services.math_tools.list() == []


def test_retirer_un_bouton(services):
    garde = services.math_tools.add("Cov", 'op("Cov")', None)
    retire = services.math_tools.add("Corr", 'op("Corr")', None)
    services.math_tools.delete(retire.id)
    assert [t.id for t in services.math_tools.list()] == [garde.id]
    with pytest.raises(UnknownMathToolError):
        services.math_tools.delete(retire.id)


def test_le_parcours_par_l_api(api):
    status, _, body = api("GET", "/api/math-tools")
    assert (status, body["data"]["tools"]) == (200, [])
    status, _, body = api("POST", "/api/math-tools", {"label": "Cov", "typst": 'op("Cov")(X, Y)', "select": "X, Y"})
    assert status == 201
    [outil] = body["data"]["tools"]
    assert outil["label"] == "Cov"
    status, _, body = api("POST", "/api/math-tools", {"label": "Cov", "typst": "x", "select": "y"})
    assert (status, body["field"]) == (422, "select")
    status, _, body = api("DELETE", f"/api/math-tools/{outil['id']}", {})
    assert (status, body["data"]["tools"]) == (200, [])
    status, _, body = api("DELETE", f"/api/math-tools/{outil['id']}", {})
    assert (status, body["title"]) == (404, "NOT_FOUND")
