> ⚠️ **Généré par IA — peut être faux, périmé ou incomplet.** Ne pas
> considérer comme source de vérité sans vérification. Toute incohérence
> constatée avec le code réel doit être signalée à Baptiste, jamais corrigée
> silencieusement (voir Règle n°2/n°3 dans [CLAUDE.md](../.claude/CLAUDE.md)).

# FRM : domaine et documents

Le FRM (GARP) a deux parties. Baptiste prépare la **Part I**, à deux avec
une partenaire de révision moins à l'aise en risque. Date d'examen non fixée
(au 2026-10-01).

## Le programme Part I

- **4 livres, ordre officiel, poids à l'examen** (study guide 2026) :
  1 Foundations of Risk Management (20 %), 2 Quantitative Analysis (20 %),
  3 Financial Markets and Products (30 %), 4 Valuation and Risk Models (30 %).
- **62 readings** (chapitres) : 11 + 15 + 20 + 16.
- **Deux numérotations.** GARP numérote par livre avec un tag : `FRM-1`…
  `FRM-11`, `QA-1`…`QA-15`, `FMP-1`…`FMP-20`, `VRM-1`…`VRM-16`. AnalystPrep
  numérote globalement (Reading 1 à 62, même ordre). Le tag `FRM-n` désigne
  le livre Foundations, pas l'examen.

## Les PDFs et ce qui fait foi

| Fichier                              | Nature                                   | Ce qu'on en tire                                        |
|--------------------------------------|------------------------------------------|---------------------------------------------------------|
| `frm-study-guide-26.pdf`             | GARP, officiel                           | Poids, knowledge points, résumé de chaque livre, liste des readings |
| `frm-learning-objective-26.pdf`      | GARP, officiel                           | Learning objectives de chaque reading (Part I et Part II) |
| `CH_1…4_*_AP.pdf`                    | AnalystPrep, tiers, mis à jour le 11/01/2025 | 1 293 QCM A–D corrigés (231 / 317 / 417 / 328), « Things to Remember » |

- **Il n'y a pas de cours.** Les livres GARP Part I ne sont pas dans le
  dossier et Baptiste ne les a pas (2026-10-01). Aucun PDF ne contient le
  texte des readings.
- **Font foi : les deux documents GARP.** Les banques AnalystPrep sont un
  entraînement tiers, édition 2025 : quelques titres de readings diffèrent
  de 2026, la correspondance reste un pour un.
- **Règle de Baptiste : rien d'inventé.** Tout contenu de programme affiché
  vient de ces PDFs et cite document et page ; ce qu'on rédige soi-même est
  séparé et présenté comme tel.

## Pièges rencontrés

**Le sommaire des banques AnalystPrep donne de fausses pages.** Juste pour le
Reading 13 (p. 54), faux pour d'autres (Reading 3 annoncé p. 48, en réalité
p. 45). Il faut repérer les en-têtes « Reading N: » dans le texte (constaté
le 2026-09-30).

**Une partie des questions est indentée.** Chercher `^Q.` en début de ligne
donne 708 questions au lieu de 1 293 ; il faut `^\s*Q\.\s?\d+`. Chacune des
1 293 a exactement une ligne « The correct answer is X » (constaté le
2026-09-30).

**Les en-têtes de learning objectives ne sont pas homogènes.** Quantitative
Analysis écrit « Chapter 1: … [QA-1] », les autres livres « Chapter 1. …
[FRM‑1] », et le tiret du tag varie (tiret simple ou insécable) (constaté le
2026-09-30).

**Pieds de page et notes se collent aux learning objectives.** La ligne
« 2026 FRM Learning Objectives » s'accroche au dernier objectif d'une page,
et la note « * This reading is freely available on the GARP website. »
partage sa ligne avec le pied de page « garp.org/frm » (constaté le
2026-09-30).

**La mise en page des questions est irrégulière.** Options parfois en
colonne 0 au lieu d'être indentées, ligne « A. » vide suivie d'une matrice
sur plusieurs lignes, numéro de page en colonne 0 en bas de page (constaté
le 2026-09-30).

**Le texte extrait abîme les formules.** Exposants perdus (« E(Y 2) » pour
E(Y²)), fractions aplaties (« 1x00 » pour x/100), petits tableaux fusionnés.
En gardant l'indentation d'origine, les calculs mis en page restent
lisibles ; le PDF fait foi (constaté le 2026-09-30).

**Les « Things to Remember » ne contiennent presque pas de formules.**
14 points sur 3 414 ; les formules sont dans les blocs de calcul des
corrigés (521 questions). Les puces disparaissent à l'extraction, les points
se suivent parfois sans ligne vide (constaté le 2026-10-01).

**pdftotext ne sort pas en UTF-8 par défaut.** Il faut `-enc UTF-8
-layout` ; et pour afficher ce texte dans un terminal Windows,
`PYTHONIOENCODING=utf-8`, sinon `UnicodeEncodeError` (cp1252) (constaté le
2026-09-30).

## Ce qui n'est pas en place

- **Livres GARP (le cours).** Absents : seuls les résumés du study guide,
  les learning objectives et les corrigés AnalystPrep existent.
- **Part II.** Ses learning objectives sont dans le PDF mais ne sont ni
  extraits ni utilisés.
- **Correspondance avec le CFA.** Refusée par Baptiste le 2026-10-01 : ne
  pas la reproposer.
