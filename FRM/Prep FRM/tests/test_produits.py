"""Tests du type « Produit financier » : des entrées du corpus qui déclarent leurs variables.

Choix de Baptiste (2026-10-08) : un produit (obligation, swap, option…) se décrit par un texte,
comme toute entrée, et par la liste des variables dont il a besoin (un nom, une note facultative),
saisie à la main. Pas de valeurs ici : on les donne dans le code. Un même produit peut déclarer
`fixed_rate` et `variable_rate`, la fonction de valorisation choisit celle qu'elle utilise.
Dans le code, `produit("id")` rend un objet dont ces variables sont des attributs vides (None).

On vérifie :
1. le stockage (variables.json), la relecture et le manifeste ;
2. l'affichage : les noms (et les notes) dans l'encadré, sur la page du corpus et dans les fiches ;
3. la validation (noms utilisables en Python, doublons) ;
4. l'objet à remplir dans le code exécuté (simulations et briques).
"""
import json
import re

import pytest

from backend.corpus import EntryMeta
from backend.errors import InvalidRequestError
from backend.journal import Contributor

BAPTISTE = Contributor("baptiste", "Baptiste Durand", "BD")
MARIE = Contributor("marie", "Marie Martin", "MM")
QUI = {"author": "baptiste", "name": "Baptiste Durand", "initials": "BD"}
FICHE = '#import "/_corpus.typ": voir, entree\n'

# Une obligation, avec les deux sortes de taux : la valorisation choisira.
OBLIGATION = [
    {"nom": "nominal", "note": ""},
    {"nom": "fixed_rate", "note": "taux fixe annuel"},
    {"nom": "variable_rate", "note": "SOFR + marge"},
    {"nom": "maturite", "note": "en années"},
]


def produit(corpus, entry_id="obligation-5-ans", variables=OBLIGATION, texte="Obligation, taux fixe ou variable.", who=BAPTISTE):
    """Raccourci : crée le produit (s'il n'existe pas) et enregistre son texte et ses variables."""
    if not corpus.exists(entry_id):
        corpus.create(entry_id, EntryMeta("produit", "Obligation 5 ans"), BAPTISTE)
    return corpus.save_text(entry_id, who, texte, None, variables=variables)


def hauteur(svg):
    """Hauteur d'une page SVG : un bloc de plus rend la page plus haute (le texte, lui, est en tracés)."""
    return float(re.search(r'<svg[^>]*\sheight="([\d.]+)', svg).group(1))


# ---------------------------------------------------------------- stockage et relecture


def test_les_variables_sont_ecrites_relues_et_dans_le_manifeste(services, site):
    corpus = services.corpus
    entree, _ = produit(corpus)
    # Elles vivent dans un fichier à part, à côté du texte, comme les hypothèses d'une formule.
    fichier = site / "notes" / "corpus" / "obligation-5-ans" / "variables.json"
    assert json.loads(fichier.read_text(encoding="utf-8")) == OBLIGATION
    # L'éditeur les relit (load_texts), l'entrée les porte, le manifeste aussi (pages sans serveur).
    assert corpus.load_texts("obligation-5-ans").variables == OBLIGATION
    assert list(entree.variables) == OBLIGATION
    assert '"nom": "variable_rate"' in (site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8")


def test_ne_pas_envoyer_les_variables_les_laisse_et_une_liste_vide_les_retire(services, site):
    corpus = services.corpus
    produit(corpus)
    fichier = site / "notes" / "corpus" / "obligation-5-ans" / "variables.json"
    # Marie ne modifie que le texte (variables non envoyées : None) : rien ne bouge.
    corpus.save_text("obligation-5-ans", MARIE, "Texte repris.", None)
    assert json.loads(fichier.read_text(encoding="utf-8")) == OBLIGATION
    # Une liste vide, elle, retire les variables.
    produit(corpus, variables=[])
    assert not fichier.exists()
    assert corpus.get("obligation-5-ans").variables == ()


def test_changer_les_variables_est_une_modification_au_journal(services):
    corpus = services.corpus
    produit(corpus, who=BAPTISTE)
    produit(corpus, variables=OBLIGATION[:2], who=MARIE)
    assert [s.author for s in corpus.get("obligation-5-ans").journal] == ["baptiste", "marie"]


def test_les_variables_sont_reservees_aux_produits(services, site):
    corpus = services.corpus
    corpus.create("variance", EntryMeta("definition", "Variance"), BAPTISTE)
    with pytest.raises(InvalidRequestError) as raised:
        corpus.save_text("variance", BAPTISTE, "Texte.", None, variables=OBLIGATION)
    assert raised.value.field == "variables"
    assert not (site / "notes" / "corpus" / "variance" / "texte.typ").exists()
    # Une liste vide n'est pas un contenu : un client qui envoie toujours le champ passe.
    corpus.save_text("variance", BAPTISTE, "Texte.", None, variables=[])


# ---------------------------------------------------------------- affichage


def test_les_variables_s_affichent_dans_l_encadre(services, site):
    corpus = services.corpus
    produit(corpus, "sans-variables", variables=[])
    produit(corpus, "noms-seuls", variables=[{"nom": "nominal", "note": ""}, {"nom": "maturite", "note": ""}])
    produit(corpus, "avec-notes")
    rendu = lambda eid: hauteur((site / "notes" / "corpus" / eid / "page-1.svg").read_text(encoding="utf-8"))
    # Sans note, les noms tiennent sur une ligne ; avec des notes, un tableau d'une ligne par variable.
    assert rendu("sans-variables") + 10 < rendu("noms-seuls") < rendu("avec-notes")


def test_une_fiche_qui_insere_le_produit_montre_ses_variables(services, site):
    corpus = services.corpus
    produit(corpus, "sans-variables", variables=[])
    produit(corpus, "avec-variables")
    generated = (site / "notes" / "_corpus.typ").read_text(encoding="utf-8")
    assert '(nom: "fixed_rate", note: "taux fixe annuel")' in generated
    page = FICHE + "#set page(height: auto)\n"
    sans = hauteur(services.compiler.svg_pages(page + '#entree("sans-variables")')[0])
    avec = hauteur(services.compiler.svg_pages(page + '#entree("avec-variables")')[0])
    assert avec > sans + 30


def test_des_caracteres_typst_dans_une_note_ne_cassent_rien(services):
    # Les notes sont du texte affiché tel quel : un « # », des crochets ou des guillemets ne doivent
    # ni casser la compilation ni être interprétés.
    corpus = services.corpus
    piege = [{"nom": "indice", "note": 'SOFR + 0,5 % "flat" [#voir] *pas du gras* $x$'}]
    entree, _ = produit(corpus, variables=piege)
    assert entree.valid
    services.compiler.svg_pages(FICHE + '#entree("obligation-5-ans")')


# ---------------------------------------------------------------- validation (API)


@pytest.mark.parametrize("variables, message", [
    ([{"nom": "maturité"}], "nom de variable"),                    # accent : pas un nom Python
    ([{"nom": "2y"}], "nom de variable"),                          # commence par un chiffre
    ([{"nom": "a"}, {"nom": "a"}], "déjà"),                        # doublon
    ([{"nom": "a", "note": 3}], "note"),                           # la note est du texte
    ([{"nom": "a", "note": "x" * 201}], "note"),                   # 200 caractères au plus
    ("pas une liste", "liste"),
    ([{"nom": f"v{i}"} for i in range(61)], "liste"),              # 60 au plus
])
def test_des_variables_mal_formees_sont_refusees(api, variables, message):
    api("POST", "/api/corpus", {"id": "obligation", "type": "produit", "titre": "Obligation", **QUI})
    status, _, body = api("PUT", "/api/corpus/obligation/texte", {"source": "Texte.", "variables": variables, **QUI})
    assert (status, body["field"]) == (422, "variables")
    assert message in body["detail"]


def test_le_parcours_par_l_api(api):
    status, _, _ = api("POST", "/api/corpus", {"id": "obligation", "type": "produit", "titre": "Obligation", **QUI})
    assert status == 201
    # Aperçu avec les variables, puis enregistrement, puis relecture.
    status, _, body = api("POST", "/api/compile/entry", {"type": "produit", "titre": "Obligation", "source": "Texte.", "variables": OBLIGATION})
    assert status == 200 and body["data"]["pages"][0].startswith("<svg")
    status, _, body = api("PUT", "/api/corpus/obligation/texte", {"source": "Texte.", "variables": OBLIGATION, **QUI})
    assert status == 200 and body["data"]["variables"] == OBLIGATION
    _, _, body = api("GET", "/api/corpus/obligation/texte")
    assert body["data"]["variables"] == OBLIGATION
    # La note est facultative, ses espaces retirés ; une valeur envoyée par un ancien client est ignorée.
    _, _, body = api("PUT", "/api/corpus/obligation/texte", {"source": "Texte.", "variables": [{"nom": "nominal", "valeur": 100, "note": " pair "}], **QUI})
    assert body["data"]["variables"] == [{"nom": "nominal", "note": "pair"}]


# ---------------------------------------------------------------- l'objet à remplir, dans le code


def test_le_code_recoit_un_objet_aux_variables_vides_a_remplir(services):
    produit(services.corpus)
    code = (
        "from produits import produit\n"
        "p = produit('obligation-5-ans')\n"
        "print(p.a_remplir())\n"
        "p.nominal = 100\n"
        "p.fixed_rate = 0.04\n"
        "print(p.nominal * p.fixed_rate, p.variable_rate)\n"
        "print(p.notes()['variable_rate'])\n"
    )
    result = services.simulations.run(code)
    assert result.ok, result.error
    # Toutes déclarées, toutes vides au départ ; le code remplit celles qu'il utilise.
    assert result.stdout.splitlines() == ["['nominal', 'fixed_rate', 'variable_rate', 'maturite']", "4.0 None", "SOFR + marge"]


def test_chaque_appel_donne_un_objet_neuf(services):
    # Deux obligations décrites par la même déclaration ne se mélangent pas.
    produit(services.corpus)
    code = "from produits import produit\na = produit('obligation-5-ans')\nb = produit('obligation-5-ans')\na.nominal = 100\nprint(b.nominal)\n"
    assert services.simulations.run(code).stdout.strip() == "None"


def test_une_faute_de_frappe_sur_une_variable_est_signalee(services):
    produit(services.corpus)
    result = services.simulations.run("from produits import produit\np = produit('obligation-5-ans')\np.notionnal = 100\n")
    assert result.ok is False
    assert result.error["type"] == "AttributeError"
    assert "notionnal" in result.error["message"] and "nominal" in result.error["message"]


def test_un_produit_inconnu_donne_une_erreur_claire(services):
    produit(services.corpus)
    result = services.simulations.run("from produits import produit\nproduit('swap-10-ans')\n")
    assert result.ok is False
    assert result.error["type"] == "KeyError"
    assert "swap-10-ans" in result.error["message"] and "obligation-5-ans" in result.error["message"]


def test_une_brique_de_valorisation_recoit_le_produit_rempli(services):
    # La brique ne connaît que le produit qu'on lui passe : c'est elle qui choisit fixed_rate.
    corpus = services.corpus
    produit(corpus)
    corpus.create("coupons", EntryMeta("brique", "Coupons"), BAPTISTE)
    corpus.save_text("coupons", BAPTISTE, "Brique.", "def coupon_annuel(p):\n    return p.nominal * p.fixed_rate\n")
    code = "from produits import produit\nfrom briques.coupons import coupon_annuel\np = produit('obligation-5-ans')\np.nominal, p.fixed_rate = 100, 0.04\nprint(coupon_annuel(p))\n"
    result = services.simulations.run(code)
    assert result.ok, result.error
    assert result.stdout.strip() == "4.0"
