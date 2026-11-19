"""Tests de la validation des entrées, faite avant toute logique métier.

Toute entrée invalide doit lever une InvalidRequestError (jamais une exception quelconque),
pour passer par la table centrale des erreurs.
"""
import json

import pytest

from backend.errors import InvalidRequestError, PayloadTooLargeError
from backend.http.payload import MAX_BODY, check_body_size, parse_note_payload, parse_note_target


def test_une_cible_valide_est_convertie_en_types():
    # Les paramètres d'URL arrivent en texte : le reading devient un entier. Une fiche par reading.
    assert parse_note_target("12").reading == 12


@pytest.mark.parametrize("reading", ["0", "63", "-1", "abc", "12.5", ""])
def test_un_reading_hors_programme_est_refuse(reading):
    # Le programme Part I compte 62 readings, numérotés de 1 à 62.
    with pytest.raises(InvalidRequestError) as raised:
        parse_note_target(reading)
    assert raised.value.field == "reading"


def test_un_enregistrement_donne_la_source():
    # Le corps ne porte plus que la source : l'auteur d'une modification vient de git
    # (backend/history.py), le site ne l'envoie plus. Un champ en trop est simplement ignoré.
    payload = parse_note_payload(json.dumps({"source": "## Fiche", "author": "baptiste"}).encode())
    assert payload.source == "## Fiche"


@pytest.mark.parametrize("body", [b"pas du json", b"[1, 2]", b'{"source": 42}', b"{}", b"\xff\xfe"])
def test_un_corps_invalide_est_refuse(body):
    # JSON cassé, mauvais type, champ absent, octets non UTF-8 : toujours la même erreur métier.
    with pytest.raises(InvalidRequestError):
        parse_note_payload(body)


def test_un_corps_trop_gros_est_refuse_avant_lecture():
    # La taille est vérifiée sur l'en-tête Content-Length, avant de lire le corps.
    check_body_size(MAX_BODY)  # pile à la limite : accepté
    with pytest.raises(PayloadTooLargeError):
        check_body_size(MAX_BODY + 1)
