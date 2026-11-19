"""Tests des images partagées (notes/images/), utilisées par les fiches et les entrées du corpus.

Ce qu'on protège ici :
1. une image ajoutée se cite par son nom de fichier, ![[nom.png|500]], comme dans Obsidian
   (notes/ est le coffre) ; le site l'affiche depuis notes/images/ ;
2. une image n'est jamais remplacée : un nom pris l'est pour de bon, quel que soit le format ;
3. le serveur ne croit pas le client sur parole : nom, format annoncé et contenu sont vérifiés.
"""
import base64
import io

import pytest
from PIL import Image as PilImage

from backend.corpus import EntryMeta, citations
from backend.errors import ImageExistsError, InvalidRequestError
from backend.images import MAX_IMAGE_BYTES


def png(couleur=(200, 30, 30), taille=(40, 20)):
    """Une vraie petite image PNG, en octets."""
    tampon = io.BytesIO()
    PilImage.new("RGB", taille, couleur).save(tampon, "PNG")
    return tampon.getvalue()


def jpg():
    tampon = io.BytesIO()
    PilImage.new("RGB", (40, 20), (30, 30, 200)).save(tampon, "JPEG")
    return tampon.getvalue()


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'


# ---------------------------------------------------------------- ajout et liste


def test_ajouter_une_image_l_ecrit_dans_le_dossier_commun(services, site):
    image = services.images.save("courbe-des-taux", "png", png())
    # Un seul dossier pour tout le monde, dans le coffre Obsidian (notes/).
    assert (site / "notes" / "images" / "courbe-des-taux.png").read_bytes() == png()
    # Ce qu'on écrit dans une fiche : le nom du fichier, unique dans le coffre (![[courbe-des-taux.png]]).
    assert image.link == "courbe-des-taux.png"
    assert [i.name for i in services.images.list()] == ["courbe-des-taux"]


def test_sans_image_la_liste_est_vide(services):
    # Le dossier n'existe pas tant qu'on n'a rien ajouté : pas d'erreur pour autant.
    assert services.images.list() == []


@pytest.mark.parametrize("fmt, donnees", [("png", png()), ("jpg", jpg()), ("svg", SVG)])
def test_les_formats_lus_par_les_navigateurs_sont_acceptes(services, fmt, donnees):
    image = services.images.save("image-test", fmt, donnees)
    assert image.format == fmt


# ---------------------------------------------------------------- jamais remplacée


def test_un_nom_deja_pris_est_refuse_meme_dans_un_autre_format(services, site):
    services.images.save("courbe", "png", png())
    # Même nom, autre format : refusé, sinon « courbe » désignerait deux images.
    with pytest.raises(ImageExistsError) as raised:
        services.images.save("courbe", "jpg", jpg())
    # L'erreur donne le lien de l'image existante : l'éditeur propose de l'insérer à la place.
    assert raised.value.link == "courbe.png"
    # Et l'image d'origine n'a pas bougé.
    assert (site / "notes" / "images" / "courbe.png").read_bytes() == png()
    assert not (site / "notes" / "images" / "courbe.jpg").exists()


# ---------------------------------------------------------------- vérifications


@pytest.mark.parametrize("nom", ["Courbe", "courbe des taux", "a", "../evil", "-courbe", "courbe.png"])
def test_un_nom_mal_forme_est_refuse(services, nom):
    # Minuscules, chiffres et tirets seulement : un nom lisible, et pas de chemin détourné.
    with pytest.raises(InvalidRequestError) as raised:
        services.images.save(nom, "png", png())
    assert raised.value.field == "name"


def test_le_contenu_doit_correspondre_au_format_annonce(services):
    # Le client annonce « png » mais envoie un JPEG : le serveur lit les premiers octets.
    with pytest.raises(InvalidRequestError) as raised:
        services.images.save("courbe", "png", jpg())
    assert raised.value.field == "data"
    # Du texte quelconque n'est une image dans aucun format.
    with pytest.raises(InvalidRequestError):
        services.images.save("courbe", "svg", b"bonjour")


def test_un_format_inconnu_est_refuse(services):
    with pytest.raises(InvalidRequestError) as raised:
        services.images.save("courbe", "bmp", b"BM....")
    assert raised.value.field == "format"


def test_une_image_trop_lourde_est_refusee(services):
    # Le navigateur compresse bien en dessous ; la limite du serveur est un garde-fou.
    with pytest.raises(InvalidRequestError) as raised:
        services.images.save("enorme", "png", b"\x89PNG\r\n\x1a\n" + b"0" * MAX_IMAGE_BYTES)
    assert raised.value.field == "data"


# ---------------------------------------------------------------- dans les fiches et les entrées


def test_une_image_n_est_pas_prise_pour_une_entree_du_corpus(services):
    # ![[courbe.png|500]] est une image : elle ne doit ni compter comme citation d'une entrée
    # « courbe », ni rattacher quoi que ce soit (les identifiants d'entrée n'ont pas de point).
    services.images.save("courbe", "png", png())
    services.corpus.create("taux", EntryMeta("definition", "Courbe des taux"))
    services.corpus.save_text("taux", "Voir la figure :\n\n![[courbe.png|500]]\n", None)
    assert citations("![[courbe.png|500]]") == set()
    assert services.corpus.get("taux").cites == ()


# ---------------------------------------------------------------- API


def test_le_parcours_par_l_api(api):
    donnees = base64.b64encode(png()).decode("ascii")

    status, _, body = api("GET", "/api/images")
    assert (status, body["data"]["images"]) == (200, [])
    assert body["links"]["create"]["method"] == "POST"

    status, _, body = api("POST", "/api/images", {"name": "courbe", "format": "PNG", "data": donnees})
    assert status == 201
    # Le format est mis en minuscules ; deux adresses : pour le site, et pour la fiche (![[…]]).
    assert body["data"]["url"] == "/notes/images/courbe.png"
    assert body["data"]["link"] == "courbe.png"

    # Le fichier est bien servi par le site, tel quel.
    status, headers, raw = api("GET", "/notes/images/courbe.png")
    assert status == 200 and headers["Content-Type"] == "image/png"

    # Même nom : 409, avec le lien de l'image existante.
    status, _, body = api("POST", "/api/images", {"name": "courbe", "format": "png", "data": donnees})
    assert (status, body["title"], body["link"]) == (409, "IMAGE_CONFLICT", "courbe.png")

    # Du base64 invalide : 422 sur le champ data, avant toute écriture.
    status, _, body = api("POST", "/api/images", {"name": "autre", "format": "png", "data": "pas du base64 !"})
    assert (status, body["field"]) == (422, "data")

    _, _, body = api("GET", "/api/images")
    assert [image["name"] for image in body["data"]["images"]] == ["courbe"]


def test_une_capture_de_deux_mega_octets_passe_la_limite_des_requetes(api):
    # Avant les images, une requête était limitée à 1 Mo. Une capture compressée de 2 Mo
    # pèse environ 2,7 Mo en base64 : elle doit passer.
    gros = b"\x89PNG\r\n\x1a\n" + b"0" * 2_000_000
    status, _, body = api("POST", "/api/images", {"name": "grosse", "format": "png", "data": base64.b64encode(gros).decode("ascii")})
    assert status == 201, body
