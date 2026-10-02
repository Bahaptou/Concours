"""Tests de la validation des entrées, faite avant toute logique métier.

Toute entrée invalide doit lever une InvalidRequestError (jamais une exception quelconque),
pour passer par la table centrale des erreurs.
"""
import pytest

from backend.errors import InvalidRequestError, PayloadTooLargeError
from backend.http.payload import MAX_BODY, check_body_size, parse_note_target, parse_source_payload


def test_une_cible_valide_est_convertie_en_types():
    # Les paramètres d'URL arrivent en texte : le reading devient un entier.
    target = parse_note_target("12", "baptiste")
    assert target.reading == 12
    assert target.author == "baptiste"


@pytest.mark.parametrize("reading", ["0", "63", "-1", "abc", "12.5", ""])
def test_un_reading_hors_programme_est_refuse(reading):
    # Le programme Part I compte 62 readings, numérotés de 1 à 62.
    with pytest.raises(InvalidRequestError) as raised:
        parse_note_target(reading, "baptiste")
    assert raised.value.field == "reading"


@pytest.mark.parametrize("author", ["", "Baptiste", "../evil", "a b", "é", "-tiret", "x" * 41])
def test_un_auteur_mal_forme_est_refuse(author):
    # L'auteur sert à construire un nom de fichier : on n'accepte que minuscules, chiffres et tirets,
    # ce qui empêche aussi toute remontée de dossier (« ../ »).
    with pytest.raises(InvalidRequestError) as raised:
        parse_note_target("12", author)
    assert raised.value.field == "author"


def test_un_corps_valide_donne_la_source():
    assert parse_source_payload(b'{"source": "= Titre"}').source == "= Titre"


@pytest.mark.parametrize("body", [b"pas du json", b"[1, 2]", b'{"source": 42}', b"{}", b"\xff\xfe"])
def test_un_corps_invalide_est_refuse(body):
    # JSON cassé, mauvais type, champ absent, octets non UTF-8 : toujours la même erreur métier.
    with pytest.raises(InvalidRequestError):
        parse_source_payload(body)


def test_un_corps_trop_gros_est_refuse_avant_lecture():
    # La taille est vérifiée sur l'en-tête Content-Length, avant de lire le corps.
    check_body_size(MAX_BODY)  # pile à la limite : accepté
    with pytest.raises(PayloadTooLargeError):
        check_body_size(MAX_BODY + 1)
