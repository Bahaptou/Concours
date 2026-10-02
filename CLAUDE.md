> ⚠️ **Généré par IA — peut être faux, périmé ou incomplet.** Ne pas
> considérer comme source de vérité sans vérification. Toute incohérence
> constatée avec le code réel doit être signalée à Baptiste, jamais corrigée
> silencieusement (voir Règle n°2/n°3 dans [CLAUDE.md](.claude/CLAUDE.md)).

# Concours

Préparation de Baptiste à deux certifications financières : le **CFA**
(Chartered Financial Analyst, CFA Institute) et le **FRM** (Financial Risk
Manager, GARP). Le dossier contient surtout des PDFs de cours et
d'entraînement, et un seul projet de code : Prep FRM.

| Dossier        | Contenu                                                                 | Code          |
|----------------|-------------------------------------------------------------------------|---------------|
| `CFA/Level1/`  | Curriculum officiel CFA Level I 2025 (10 volumes, `L1 2025/`), SchweserNotes 2025 de Kaplan (4 PDFs), lectures prérequises 2024 (`Prerequisite/` : Quant, Economics, FSA) | Aucun |
| `FRM/`         | Documents FRM Part I 2026 (study guide, learning objectives, banques de questions AnalystPrep) | `FRM/Prep FRM/` |

## Tu vas toucher à... / Lire d'abord

| Tu vas toucher à...              | Lire d'abord                                         |
|----------------------------------|------------------------------------------------------|
| `FRM/` (PDFs, domaine FRM)       | `FRM/CLAUDE.md`                                      |
| `FRM/Prep FRM/`                  | `FRM/Prep FRM/CLAUDE.md`, puis son `README.md`       |
| `CFA/`                           | Rien de documenté : demander à Baptiste              |
| WorldTradeFinance4 (modèle)      | `../WorldTradeFinance4/.claude/CLAUDE.md`            |

## Règles

- **Les PDFs sont sous droits.** CFA Institute : « For candidate use only.
  Not for distribution. » ; AnalystPrep : « Reproduction and/or distribution
  of this document is prohibited. » Usage personnel uniquement. Ils sont
  versionnés dans le dépôt GitHub **privé** `Bahaptou/Concours` (décision de
  Baptiste le 2026-10-02, « pour l'instant ») ; ne jamais les publier ni les
  téléverser ailleurs (artifact, service en ligne, dépôt public). Rendre le
  dépôt public serait les publier : en parler à Baptiste avant.
- **Les PDFs ne se renomment ni ne se déplacent.** Les outils de Prep FRM
  les lisent par leur nom de fichier.
- **CFA et FRM restent séparés.** Baptiste a refusé le 2026-10-01 tout
  croisement de contenu entre les deux (par exemple renvoyer un reading FRM
  vers un chapitre CFA qui traite du même sujet).

## Pièges rencontrés

Aucun à ce niveau : voir `FRM/CLAUDE.md` et `FRM/Prep FRM/CLAUDE.md`.

## Ce qui n'est pas en place

- **Outils pour le CFA.** Aucun code ne lit les PDFs CFA.
