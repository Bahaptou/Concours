"""Tests du type « Produit financier » : des entrées du corpus qui déclarent leurs variables.

Choix de Baptiste (2026-10-08) : un produit (obligation, swap, option…) se décrit par un texte,
comme toute entrée, et par la liste des variables dont il a besoin (un nom, une note facultative),
saisie à la main. Pas de valeurs ici : on les donne dans le code. Un même produit peut déclarer
`fixed_rate` et `variable_rate`, la fonction de valorisation choisit celle qu'elle utilise.
Dans le code, `produit("id")` rend un objet dont ces variables sont des attributs vides (None).

Depuis le 2026-11-19, les variables vivent dans l'en-tête YAML du fichier de l'entrée
(notes/corpus/<id>.md, clé `variables`), qu'Obsidian affiche comme une propriété.

On vérifie :
1. le stockage (en-tête YAML), la relecture et le manifeste ;
2. la validation (noms utilisables en Python, doublons) ;
3. l'objet à remplir dans le code exécuté (simulations et briques).
"""
import pytest

from backend.corpus import EntryMeta
from backend.errors import InvalidRequestError
from backend.frontmatter import Document

# Une obligation, avec les deux sortes de taux : la valorisation choisira.
OBLIGATION = [
    {"nom": "nominal", "note": ""},
    {"nom": "fixed_rate", "note": "taux fixe annuel"},
    {"nom": "variable_rate", "note": "SOFR + marge"},
    {"nom": "maturite", "note": "en années"},
]


def produit(corpus, entry_id="obligation-5-ans", variables=OBLIGATION, texte="Obligation, taux fixe ou variable."):
    """Raccourci : crée le produit (s'il n'existe pas) et enregistre son texte et ses variables."""
    if not corpus.exists(entry_id):
        corpus.create(entry_id, EntryMeta("produit", "Obligation 5 ans"))
    return corpus.save_text(entry_id, texte, None, variables=variables)


def en_tete(site, entry_id="obligation-5-ans"):
    """L'en-tête YAML du fichier de l'entrée, relu comme le ferait Obsidian."""
    return Document.parse((site / "notes" / "corpus" / f"{entry_id}.md").read_text(encoding="utf-8")).data


# ---------------------------------------------------------------- stockage et relecture


def test_les_variables_sont_ecrites_relues_et_dans_le_manifeste(services, site):
    corpus = services.corpus
    entree = produit(corpus)
    # Elles vivent dans l'en-tête YAML, à côté du type et du titre.
    assert [dict(v) for v in en_tete(site)["variables"]] == OBLIGATION
    # L'éditeur les relit (load_texts), l'entrée les porte, le manifeste aussi (pages sans serveur).
    assert corpus.load_texts("obligation-5-ans").variables == OBLIGATION
    assert list(entree.variables) == OBLIGATION
    assert '"nom": "variable_rate"' in (site / "notes" / "corpus" / "index.js").read_text(encoding="utf-8")


def test_ne_pas_envoyer_les_variables_les_laisse_et_une_liste_vide_les_retire(services, site):
    corpus = services.corpus
    produit(corpus)
    # On ne modifie que le texte (variables non envoyées : None) : rien ne bouge.
    corpus.save_text("obligation-5-ans", "Texte repris.", None)
    assert [dict(v) for v in en_tete(site)["variables"]] == OBLIGATION
    # Une liste vide, elle, retire la clé de l'en-tête.
    produit(corpus, variables=[])
    assert "variables" not in en_tete(site)
    assert corpus.get("obligation-5-ans").variables == ()


def test_les_variables_sont_reservees_aux_produits(services, site):
    corpus = services.corpus
    corpus.create("variance", EntryMeta("definition", "Variance"))
    with pytest.raises(InvalidRequestError) as raised:
        corpus.save_text("variance", "Texte.", None, variables=OBLIGATION)
    assert raised.value.field == "variables"
    assert corpus.get("variance").source == ""  # rien n'a été écrit
    # Une liste vide n'est pas un contenu : un client qui envoie toujours le champ passe.
    corpus.save_text("variance", "Texte.", None, variables=[])


def test_des_caracteres_speciaux_dans_une_note_restent_tels_quels(services, site):
    # Les notes sont du texte affiché tel quel : un « # », des crochets, des guillemets ou des
    # deux-points ne doivent ni casser l'en-tête YAML ni changer à la relecture.
    corpus = services.corpus
    piege = [{"nom": "indice", "note": 'SOFR + 0,5 % "flat" [[voir]] : *pas du gras* $x$ # pas un commentaire'}]
    entree = produit(corpus, variables=piege)
    assert list(entree.variables) == piege
    assert [dict(v) for v in en_tete(site)["variables"]] == piege


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
    api("POST", "/api/corpus", {"id": "obligation", "type": "produit", "titre": "Obligation"})
    status, _, body = api("PUT", "/api/corpus/obligation/texte", {"source": "Texte.", "variables": variables})
    assert (status, body["field"]) == (422, "variables")
    assert message in body["detail"]


def test_le_parcours_par_l_api(api):
    status, _, _ = api("POST", "/api/corpus", {"id": "obligation", "type": "produit", "titre": "Obligation"})
    assert status == 201
    # Enregistrement, puis relecture.
    status, _, body = api("PUT", "/api/corpus/obligation/texte", {"source": "Texte.", "variables": OBLIGATION})
    assert status == 200 and body["data"]["variables"] == OBLIGATION
    _, _, body = api("GET", "/api/corpus/obligation/texte")
    assert body["data"]["variables"] == OBLIGATION
    # La note est facultative, ses espaces retirés ; une valeur envoyée par un ancien client est ignorée.
    _, _, body = api("PUT", "/api/corpus/obligation/texte", {"source": "Texte.", "variables": [{"nom": "nominal", "valeur": 100, "note": " pair "}]})
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
    corpus.create("coupons", EntryMeta("brique", "Coupons"))
    corpus.save_text("coupons", "Brique.", "def coupon_annuel(p):\n    return p.nominal * p.fixed_rate\n")
    code = "from produits import produit\nfrom briques.coupons import coupon_annuel\np = produit('obligation-5-ans')\np.nominal, p.fixed_rate = 100, 0.04\nprint(coupon_annuel(p))\n"
    result = services.simulations.run(code)
    assert result.ok, result.error
    assert result.stdout.strip() == "4.0"
