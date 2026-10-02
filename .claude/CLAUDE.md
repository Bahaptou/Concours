> ⚠️ **Généré par IA — peut être faux, périmé ou incomplet.** Ne pas
> considérer comme source de vérité sans vérification. Toute incohérence
> constatée avec le code réel doit être signalée à Baptiste, jamais corrigée
> silencieusement (voir Règle n°2/n°3 ci-dessous).

# Concours

Préparation de Baptiste au CFA et au FRM : des PDFs de cours et
d'entraînement, et un seul projet de code, `FRM/Prep FRM/`. Le contenu des
dossiers est décrit dans le `CLAUDE.md` racine ; ce fichier fixe les règles
de travail.

## Règle n°1 — Lecture obligatoire avant toute modification de code

Avant de modifier un fichier, tu dois avoir lu le `.md` qui documente le
dossier/module concerné. Cette règle s'applique en cascade :

- Si une tâche te fait toucher un deuxième dossier documenté (même en cours
  de route, même si ce n'était pas prévu au départ), tu t'arrêtes et tu lis
  le `.md` correspondant **avant** de modifier quoi que ce soit dans ce
  dossier.
- Ça s'applique peu importe le nombre de sauts dans une même tâche. Pas
  d'exception pour "modification triviale" ou "je connais déjà ce fichier".
- Tu ne pars jamais du principe qu'un pattern vu dans le code est LA
  convention standard sans l'avoir vérifié dans le `.md` correspondant.

La table « Tu vas toucher à... / Lire d'abord » est dans le `CLAUDE.md`
racine. Il n'y en a qu'une, pour qu'elle ne diverge pas d'une copie.

**Cette table fait partie de la documentation à maintenir.** Si elle est
incomplète (nouveau dossier documenté absent de la table), obsolète (fichier
renommé/déplacé/supprimé), ou ambiguë, c'est une incohérence au même titre
que celles couvertes par la Règle n°2 : tu la signales, et toute correction
de cette table ou de ce fichier suit la même procédure de diff + validation
que la Règle n°3.

La table grossit au fur et à mesure. Un module ne mérite son propre `.md`
que s'il a quelque chose de **non déductible** des docs existantes : si son
comportement est déjà couvert par une doc transverse, une mention suffit.
Pas de redondance documentaire. Chaque nouveau `.md` est proposé et validé
au moment où il devient nécessaire (voir Règle n°3), pas à l'avance.

## Règle n°2 — Vigilance continue sur la fidélité doc ↔ code

Tous les `CLAUDE.md` (et les fichiers de `.claude/docs/`, s'il y en a) sont
générés par IA et peuvent être faux, périmés ou incomplets (voir bandeau en
tête de chaque fichier). Les `README.md` sont écrits pour des lecteurs
humains, mais la même vigilance s'applique.

- À tout moment — pendant une lecture, une analyse, une modification, peu
  importe la tâche en cours, même si elle n'a rien à voir avec la
  documentation — si tu détectes une incohérence entre un `.md` et le code
  réel, tu la signales immédiatement à Baptiste. Tu ne continues pas comme
  si de rien n'était, et tu ne corriges pas le `.md` toi-même (Règle n°3).
- À la fin de chaque tâche qui a modifié du code, tu évalues l'ensemble des
  `.md` potentiellement concernés — pas seulement celui du fichier édité.
  Demande-toi explicitement :
  - Est-ce que ce changement rend un `.md` existant faux ou incomplet ?
  - Est-ce qu'un nouveau sous-module mériterait désormais son propre `.md`,
    au sens du critère de non-redondance de la Règle n°1 ?
  - Est-ce que l'arborescence des `.md` a encore du sens ?
- La doc doit être fidèle au code à la fin de chaque tâche — mais "fidèle"
  veut dire proposée et validée par Baptiste, jamais auto-appliquée.

## Règle n°3 — Contrôle total de Baptiste sur la documentation

Tu ne modifies, ne crées, ne supprimes ni ne réorganises **jamais** un
fichier de documentation sans validation explicite préalable : tout
`CLAUDE.md` (racine, `FRM/`, `FRM/Prep FRM/`, ce fichier), tout `README.md`,
tout fichier de `.claude/docs/`. Aucune exception, même pour une coquille
évidente.

- Avant toute écriture dans l'un de ces fichiers, tu présentes à Baptiste :
  1. un diff au format git (`-`/`+` ligne par ligne) du changement proposé
  2. pour les réécritures substantielles ou les créations de fichiers : le
     texte final complet du fichier

  Pour les changements mineurs (ajout d'une ligne, correction d'un nom,
  mise à jour d'une valeur), le diff seul suffit.

  Ceci s'applique à toute opération : modification, création,
  réorganisation de l'arborescence (déplacement, fusion, scission).
- Tu attends une validation explicite avant d'écrire quoi que ce soit. Même
  si ça traîne : une proposition non validée n'est pas écrite.
- Si tu hésites entre "faire confiance au `.md` tel quel" et "le corriger",
  tu poses la question plutôt que de trancher seul.

## Règle n°4 — Format des docs

Chaque `CLAUDE.md` et chaque fichier de `.claude/docs/` :

- commence par le bandeau ⚠️ « Généré par IA » (celui en tête de ce
  fichier, avec le lien vers ce `.claude/CLAUDE.md`) ;
- a une section **« Pièges rencontrés »** : bugs réellement vécus, pas des
  précautions théoriques. Chaque piège est un titre-phrase en gras (point
  inclus dans le gras) suivi d'un paragraphe sans puce. Les constats et
  mesures sont datés en absolu (« constaté le 2026-10-01 ») ;
- a une section **« Ce qui n'est pas en place »** : liste à puces, chaque
  puce commence par un titre en gras avec point final, puis l'explication.
  Sert à éviter que quelqu'un redécouvre une impasse.

Les `README.md` (lecteurs humains, GitHub) n'ont pas le bandeau.

## Règle n°5 — Langues

- Documentation en français.
- Nouveaux commentaires et docstrings **en anglais**. Les commentaires
  existants dans une autre langue sont conservés tels quels.
- **Exception : les tests**, où commentaires et docstrings sont **en
  français**, abondants : expliquer ce qui est testé, pourquoi, et chaque
  étape du scénario.

## Règle n°6 — Spécifique à Concours

- **Python passe par uv** (`uv run`, `uv add`), jamais `pip install`. Prep
  FRM est un projet uv autonome (`FRM/Prep FRM/pyproject.toml`, `uv.lock`
  commité, Python 3.13 fixé par `.python-version`) : on le lance depuis son
  dossier.
- **PDFs et séparation CFA/FRM** : les règles sont dans la section « Règles »
  du `CLAUDE.md` racine, pas répétées ici.
- **WorldTradeFinance4** (dossier voisin `../WorldTradeFinance4`, autre projet
  de Baptiste, le plus abouti) est le modèle d'architecture et de conventions
  de Prep FRM. On peut le consulter et en discuter avec sa session Claude :
  lire d'abord son `.claude/CLAUDE.md`, puis `.claude/docs/overview.md`.
  Consultation en lecture seule ; toute modification de WTF4 se fait dans sa
  propre session.

### Règles générales héritées

- Ne pas inventer ni deviner : en cas de doute sur le code, la
  documentation, une convention ou une intention, **demander**.
- Ne jamais présumer qu'un pattern vu dans le code est LA convention
  actuelle sans confirmation.
