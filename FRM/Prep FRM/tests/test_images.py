"""Tests des images partagées (notes/images/), utilisées par les fiches et les entrées du corpus.

Ce qu'on protège ici :
1. une image ajoutée s'affiche dans une fiche ET dans une entrée insérée dans une fiche, et son
   rendu SVG la contient (les pages lues sans serveur la montrent) ;
2. une image n'est jamais remplacée : un nom pris l'est pour de bon, quel que soit le format ;
3. le serveur ne croit pas le client sur parole : nom, format annoncé et contenu sont vérifiés.
"""
import base64
import io

import pytest
from PIL import Image as PilImage

from backend.corpus import EntryMeta
from backend.journal import Contributor
from backend.errors import ImageExistsError, InvalidRequestError
from backend.images import MAX_IMAGE_BYTES

# En-tête d'une fiche qui insère des entrées du corpus.
FICHE = '#import "/_corpus.typ": voir, entree\n'


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
    # Un seul dossier pour tout le monde, sous la racine Typst (notes/).
    assert (site / "notes" / "images" / "courbe-des-taux.png").read_bytes() == png()
    # Le chemin à écrire dans une fiche part de la racine : il marche depuis n'importe quel dossier.
    assert image.typst_path == "/images/courbe-des-taux.png"
    assert [i.name for i in services.images.list()] == ["courbe-des-taux"]


def test_sans_image_la_liste_est_vide(services):
    # Le dossier n'existe pas tant qu'on n'a rien ajouté : pas d'erreur pour autant.
    assert services.images.list() == []


@pytest.mark.parametrize("fmt, donnees", [("png", png()), ("jpg", jpg()), ("svg", SVG)])
def test_les_formats_lus_par_typst_sont_acceptes(services, fmt, donnees):
    image = services.images.save("image-test", fmt, donnees)
    assert image.format == fmt


# ---------------------------------------------------------------- jamais remplacée


def test_un_nom_deja_pris_est_refuse_meme_dans_un_autre_format(services, site):
    services.images.save("courbe", "png", png())
    # Même nom, autre format : refusé, sinon « courbe » désignerait deux images.
    with pytest.raises(ImageExistsError) as raised:
        services.images.save("courbe", "jpg", jpg())
    # L'erreur donne le chemin de l'image existante : l'éditeur propose de l'insérer à la place.
    assert raised.value.typst_path == "/images/courbe.png"
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


def test_une_fiche_affiche_l_image_et_son_svg_la_contient(services):
    services.images.save("courbe", "png", png())
    pages = services.compiler.svg_pages('#image("/images/courbe.png", width: 70%)')
    # Typst embarque l'image dans le SVG (data URI) : la page Reading ouverte sans serveur la montre.
    assert 'href="data:image/png;base64,' in pages[0]


def test_une_entree_inseree_dans_une_fiche_affiche_son_image(services):
    # Le chemin part de la racine : il marche depuis corpus/<id>/ comme depuis la fiche.
    services.images.save("courbe", "png", png())
    baptiste = Contributor("baptiste", "Baptiste Durand", "BD")
    services.corpus.create("taux", EntryMeta("definition", "Courbe des taux"), baptiste)
    services.corpus.save_text("taux", baptiste, '#image("/images/courbe.png", width: 50%)', None)
    assert services.corpus.get("taux").valid is True
    pages = services.compiler.svg_pages(FICHE + '#entree("taux")')
    assert "data:image/png;base64," in pages[0]


def test_une_image_absente_donne_une_erreur_claire(services):
    # Une faute de frappe dans le nom : erreur de compilation habituelle, avec l'explication française.
    from backend.errors import TypstCompileError

    with pytest.raises(TypstCompileError) as raised:
        services.compiler.svg_pages('#image("/images/inexistante.png")')
    assert raised.value.explanation.startswith("Fichier introuvable")


# ---------------------------------------------------------------- API


def test_le_parcours_par_l_api(api):
    donnees = base64.b64encode(png()).decode("ascii")

    status, _, body = api("GET", "/api/images")
    assert (status, body["data"]["images"]) == (200, [])
    assert body["links"]["create"]["method"] == "POST"

    status, _, body = api("POST", "/api/images", {"name": "courbe", "format": "PNG", "data": donnees})
    assert status == 201
    # Le format est mis en minuscules ; deux adresses : pour le site, et pour la fiche.
    assert body["data"]["url"] == "/notes/images/courbe.png"
    assert body["data"]["typstPath"] == "/images/courbe.png"

    # Le fichier est bien servi par le site, tel quel.
    status, headers, raw = api("GET", "/notes/images/courbe.png")
    assert status == 200 and headers["Content-Type"] == "image/png"

    # Même nom : 409, avec le chemin de l'image existante.
    status, _, body = api("POST", "/api/images", {"name": "courbe", "format": "png", "data": donnees})
    assert (status, body["title"], body["typstPath"]) == (409, "IMAGE_CONFLICT", "/images/courbe.png")

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
