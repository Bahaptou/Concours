"""Tests du service de compilation Typst.

La bibliothèque Python de Typst ne donne pas la position des erreurs : le service la retrouve
lui-même. On vérifie ici les deux méthodes (recherche du nom inconnu, puis découpage du texte).
"""
import pytest

from backend.compiler import TypstCompiler
from backend.errors import TypstCompileError


@pytest.fixture
def compiler(site):
    # La racine Typst est le dossier notes/ du faux site, qui contient le gabarit.
    return TypstCompiler(site / "notes")


def test_une_source_valide_donne_des_pages_svg(compiler):
    pages = compiler.svg_pages("= Titre\nBayes : $ P(A|B) = (P(B|A) P(A)) / P(B) $")
    assert len(pages) == 1
    assert pages[0].startswith("<svg")


def test_le_gabarit_s_importe_depuis_la_racine_des_notes(compiler):
    # Les fiches écrivent « #import "/_gabarit.typ" » : le « / » désigne la racine notes/.
    pages = compiler.svg_pages('#import "/_gabarit.typ": *\n#retenir[À retenir]')
    assert pages


def test_plusieurs_pages_donnent_plusieurs_svg(compiler):
    pages = compiler.svg_pages("Page 1\n#pagebreak()\nPage 2")
    assert len(pages) == 2


def test_le_pdf_est_produit(compiler):
    assert compiler.pdf("= Titre").startswith(b"%PDF")


def test_un_nom_inconnu_est_localise_sur_sa_ligne(compiler):
    # En maths, « sigmaa » n'est pas une lettre grecque : Typst le prend pour un nom inconnu.
    source = "= Titre\n\nUne ligne\n$ sigmaa $\nfin"
    with pytest.raises(TypstCompileError) as raised:
        compiler.svg_pages(source)
    error = raised.value
    assert error.message == "unknown variable: sigmaa"
    assert error.line == 4
    # L'explication en français et les indices du compilateur sont transmis à l'éditeur.
    assert error.explanation.startswith("Nom inconnu")
    assert error.hints


def test_une_parenthese_non_fermee_est_localisee_par_decoupage(compiler):
    # Pas de nom à chercher ici : le service compile des débuts de texte de plus en plus courts
    # pour trouver la première ligne où l'erreur apparaît.
    source = "= Titre\nligne 2\nligne 3 #text(fill: red[x]\nligne 4\nligne 5"
    with pytest.raises(TypstCompileError) as raised:
        compiler.svg_pages(source)
    assert raised.value.message == "unclosed delimiter"
    assert raised.value.line == 3


def test_on_peut_renoncer_a_chercher_la_ligne(compiler):
    # La recherche de la ligne coûte une dizaine de compilations. Un appelant qui ne s'en servira
    # pas (la version d'une formule avec ses hypothèses : la ligne n'aurait aucun sens) la saute.
    source = "= Titre\n\nUne ligne\n$ sigmaa $\nfin"
    with pytest.raises(TypstCompileError) as raised:
        compiler.svg_pages(source, locate=False)
    # Le message et l'explication sont toujours là ; seule la ligne manque.
    assert raised.value.message == "unknown variable: sigmaa"
    assert raised.value.explanation.startswith("Nom inconnu")
    assert raised.value.line is None


def test_une_erreur_de_compilation_n_est_pas_marquee_enregistree(compiler):
    # Seul le service des fiches, après avoir écrit le texte sur disque, met saved à True.
    with pytest.raises(TypstCompileError) as raised:
        compiler.svg_pages("#inconnu()")
    assert raised.value.saved is False
