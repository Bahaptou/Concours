"""Tests de l'en-tête YAML et des sections des fichiers Markdown (backend/frontmatter.py).

Le site et Obsidian écrivent les mêmes fichiers. La règle (choix de Baptiste, 2026-11-19) : le
site ne touche qu'aux clés qu'il connaît. On vérifie donc qu'un fichier relu puis réécrit sans
changement revient à l'identique, octet pour octet, et qu'une modification d'une clé laisse les
autres (ordre, commentaires, guillemets) comme Obsidian les avait écrites.
"""
from backend.frontmatter import Document, Sections, join_sections, parse_sections, split

OBSIDIAN = """---
type: formule
titre: "Règle de Bayes"   # guillemets et commentaire écrits à la main
tags:
  - revoir
  - examen
aliases: [Bayes]
---
Texte de l'entrée.
"""


def test_un_fichier_relu_puis_reecrit_sans_changement_reste_identique():
    # Rien n'a changé : l'en-tête n'est pas réécrit du tout, même sa mise en forme reste.
    assert Document.parse(OBSIDIAN).dump() == OBSIDIAN


def test_changer_une_cle_garde_les_autres_comme_obsidian_les_a_ecrites():
    document = Document.parse(OBSIDIAN)
    document.set("readings", [1, 3])
    texte = document.dump()
    # La clé du site arrive à la fin, écrite en ligne.
    assert "readings: [1, 3]\n---\n" in texte
    # Ce qu'Obsidian avait écrit est intact : commentaire, guillemets, liste en colonne, ordre.
    assert 'titre: "Règle de Bayes"   # guillemets et commentaire écrits à la main' in texte
    assert "tags:\n  - revoir\n  - examen\naliases: [Bayes]\n" in texte
    assert texte.endswith("---\nTexte de l'entrée.\n")


def test_supprimer_une_cle_ne_touche_qu_elle():
    document = Document.parse(OBSIDIAN)
    document.delete("aliases")
    document.delete("absente")  # supprimer une clé absente ne fait rien
    assert "aliases" not in document.dump()
    assert "tags:" in document.dump()


def test_une_liste_de_questions_s_ecrit_une_par_ligne():
    document = Document.new()
    document.set("questions", [{"id": "33", "reading": 1}, {"id": "5", "reading": 2}])
    # Une question par ligne, chacune en ligne : lisible dans Obsidian, et un identifiant reste un texte.
    assert document.dump() == "---\nquestions:\n  - {id: '33', reading: 1}\n  - {id: '5', reading: 2}\n---\n"


def test_un_fichier_sans_en_tete_garde_son_texte():
    # Une note créée dans Obsidian sans propriétés : pas d'en-tête inventé tant que rien ne change.
    assert split("Juste du texte.\n") == (None, "Juste du texte.\n")
    assert Document.parse("Juste du texte.\n").dump() == "Juste du texte.\n"
    document = Document.parse("Juste du texte.\n")
    document.set("type", "definition")
    assert document.dump() == "---\ntype: definition\n---\nJuste du texte.\n"


def test_une_ligne_de_tirets_dans_le_texte_n_est_pas_un_en_tete():
    # Un séparateur « --- » au milieu du texte n'ouvre pas d'en-tête.
    assert split("Intro\n---\nSuite\n") == (None, "Intro\n---\nSuite\n")


# ---------------------------------------------------------------- sections


def test_les_sections_d_une_formule_sont_decoupees_puis_recomposees_a_l_identique():
    corps = "$E = mc^2$\n\n## Hypothèses\n\n- vide\n\n## Limites\n\n- relativiste\n"
    sections = parse_sections(corps, ("hypotheses", "limites"))
    assert sections == Sections(text="$E = mc^2$\n", hypotheses="- vide", limites="- relativiste")
    assert join_sections(sections) == corps


def test_seules_les_sections_de_fin_sont_reconnues():
    # « ## Limites » suivi d'un autre titre n'est pas la section : c'est du texte.
    corps = "Texte.\n\n## Limites\n\nx\n\n## Autre chose\n\ny\n"
    assert parse_sections(corps, ("hypotheses", "limites")) == Sections(text=corps)


def test_un_titre_dans_un_bloc_de_code_n_est_pas_une_section():
    corps = "Texte.\n\n## Code\n\n```python\n## pas un titre\nprint(1)\n```\n"
    sections = parse_sections(corps, ("code",))
    assert sections.code == "## pas un titre\nprint(1)"
    assert join_sections(sections) == corps


def test_les_sections_vides_disparaissent():
    assert join_sections(Sections(text="Texte.", hypotheses="  ", limites=None, code="")) == "Texte.\n"
    assert join_sections(Sections(text="")) == ""
