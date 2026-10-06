> ⚠️ **Généré par IA — peut être faux, périmé ou incomplet.** Ne pas
> considérer comme source de vérité sans vérification. Toute incohérence
> constatée avec le code réel doit être signalée à Baptiste, jamais corrigée
> silencieusement (voir Règle n°2/n°3 dans [CLAUDE.md](../../.claude/CLAUDE.md)).

# Prep FRM : doc pour agents

Site local de préparation au FRM Part I, pour Baptiste et sa partenaire de
révision. Le `README.md` dit comment s'en servir ; ce fichier dit comment
c'est construit, pourquoi, et où sont les pièges. Le domaine et les PDFs
sont dans `../CLAUDE.md`.

## Ce que fait le site

- **Programme** extrait des PDFs : livres, readings, résumés du study guide,
  learning objectives, chacun avec un lien vers sa page dans le PDF.
- **Suivi** : 4 étapes par reading (LOs lus, questions faites, simulation
  Python, fiche de présentation), note de confiance 0–4 par learning
  objective, profil (prénom, nom).
- **Questions** : les 1 293 QCM AnalystPrep, en entraînement (correction
  immédiate) ou en examen (correction à la fin, compte à rebours), examen
  blanc réparti 20/20/30/30, historique des séries consultable. L'étape 2
  se coche seule quand toutes les questions d'un reading ont été tentées.
  Une question peut être « traitée » (exploitée dans les fiches) : état à
  part des marques, avec son reading pour compter sans charger les questions.
- **Dashboard** : avancement, confiance et réussite, filtrables par livre.
- **Sauvegarde** : tout l'état en un fichier JSON, exporté dans `save/` et
  rechargeable.
- **Fiches (étape 4)** : une fiche Typst par personne et par reading,
  écrite dans `editeur.html` (CodeMirror 6, aperçu en direct, barre
  « Mode maths », menus « 📚 Corpus » et « 🖼 Images »), compilée en SVG et PDF par le
  serveur, affichée sur la page Reading.
- **Portail des fiches** (`fiches.html`, onglet « Fiches ») : les 62
  readings avec étapes, fiches et entrées utilisées ; filtres livre,
  état de la fiche (dont « écrite mais ④ non cochée » et « ④ cochée
  sans fiche »), auteur, type, recherche de chapitre (un nombre = ce
  chapitre dans chaque livre) et d'entrée ; pastilles ①–④ pour trier
  par étape (cochés d'abord, non cochés d'abord, ordre officiel). Lien
  vers `reading.html?id=N&auteur=x#notes-card`.
- **Corpus** (`corpus.html`, `entree.html`) : formules, définitions,
  propriétés, théorèmes, simulations et briques de code écrits par nous. Identifiant
  lisible, titre et type communs, une version par personne signée de ses
  initiales, readings tirés des fiches qui l'utilisent. Les entrées se
  citent (`#voir`) ; les fiches citent ou insèrent (`#entree`). Simulations
  et briques ont une section de code Python séparée de leur description.
  Une formule a de même deux champs, Hypothèses et Limites, affichés en blocs sous elle.
  Vues Liste (tri titre / usage / date) et Stats (`corpus-stats.js`),
  mêmes filtres : type, livre ou « sans reading », reading, auteur,
  recherche.
- **Python (étape 3)** : ▶ Exécuter via le serveur (`/api/run`), sortie,
  erreur et ligne, figures matplotlib ; limite de temps réglable (30 s,
  300 s max) ; étape ③ cochée après une exécution réussie, pour les
  readings de la simulation. Une brique est un module :
  `from briques.donnees_aleatoires import …`.

## Architecture

- **Pages HTML vides** (`index`, `dashboard`, `quiz`, `livre`, `reading`,
  `corpus`, `fiches`),
  rendues par des scripts classiques qui remplissent un objet global `FRM`,
  dans l'ordre des balises : `data/curriculum.js` → `store` → `core` →
  `questions` → `ui` → `save` → `profile` → (`quiz-view`, `charts`) → script
  de la page. La page Corpus charge aussi `charts` puis `corpus-stats`
  (infobulles, barres et tableau partagés).
- **Données générées, jamais éditées à la main** : `data/curriculum.js`
  (`tools/extract_curriculum.py`), `data/questions/rN.js`
  (`tools/extract_questions.py`), `save/exemple-demo.json`
  (`tools/make_demo_save.py`, données fictives).
- **État utilisateur** dans `localStorage` : `frm-part1.state.v1` (tout ce
  qui est sauvegardé, format décrit en tête de `store.js`),
  `frm-part1.session.v1` (série en cours, hors sauvegarde),
  `frm-part1.dashboard.v1` (filtres du dashboard).
- **Graphiques** en SVG/HTML écrits à la main (`charts.js`), sans
  bibliothèque.
- **Serveur local** (`server.py` + `backend/`), calqué en plus léger sur
  WorldTradeFinance4 : `errors.py` (hiérarchie `AppError`, sans HTTP),
  services `compiler.py`, `notes.py`, `corpus.py` (un verrou chacun,
  jamais imbriqués ; écritures atomiques via `files.py`) et
  `simulations.py` (sous-processus, au plus 2 en parallèle), `images.py`,
  `math_tools.py` (boutons de maths ajoutés, `notes/_outils-maths.json`), puis
  `http/` : `guard.py` (seul le site servi passe), `payload.py`
  (validation), `routes.py` (une fonction par route), `context.py`,
  `presenter.py` (enveloppe `{data, links}`), `problem.py` (RFC 9457,
  table unique résolue par MRO), `handler.py` (seul point de conversion
  exception → réponse). Tests dans `tests/` (`uv run pytest`).
- **Éditeurs** : `editeur.html` (fiche) et `entree.html` (entrée du
  corpus) chargent les scripts classiques puis un module ES
  (`assets/js/pages/editeur.js`, `entree.js`, et `assets/js/editor/` :
  `setup.js` commun, `toolbar.js`, `corpus-picker.js`, `api.js`), donc
  uniquement via le serveur. CodeMirror est regroupé dans
  `assets/vendor/codemirror/` par `tools/vendor_codemirror/`.
- **Fiches** : `notes/r<N>/fiche-<auteur>.typ`, rendus
  `fiche-<auteur>-<page>.svg` et `.pdf` ; `notes/_gabarit.typ` est
  importé en `/_gabarit.typ` (`notes/` = racine Typst) ; `notes/index.js`
  (généré) liste les fiches pour les pages ouvertes en `file://`.
- **Corpus** : `notes/corpus/<id>/entree.json` (type, titre, auteurs avec
  `valide`, `questions` liées : identifiant et reading), `<auteur>.typ`, `<auteur>.hypotheses.typ` et `<auteur>.limites.typ`
  (formule), `<auteur>.py` (simulation, brique),
  `<auteur>-<page>.svg`. Régénérés à chaque écriture du corpus, à chaque
  enregistrement de fiche et au démarrage :
  `notes/_corpus-titres.typ` (titres + `voir`), `notes/_corpus.typ`
  (versions valides + `entree`), `notes/corpus/index.js` (pour
  `file://`, avec `citedBy` et `usedBy`).

## Décisions et raisons

- **Exécution Python par le serveur local** (sous-processus `-I`, dossier
  temporaire, `main.py` + paquet `briques/` + `_runner.py`), choisie le
  2026-10-01. Tout le front passe par `assets/js/runner.js` (`execute`) :
  une exécution dans le navigateur (Pyodide) pourrait s'y substituer
  sans toucher aux pages.
- **Une erreur du code exécuté est un résultat** : 200 avec `ok: false`
  et `error` (type, message, ligne). Seul l'échec de lancement est une
  erreur d'API (500 `RUNNER_ERROR`).
- **Version d'une brique à l'exécution** : celle de l'auteur du code,
  sinon la première autre par ordre alphabétique (choix de Baptiste) ;
  la réponse liste les briques importées et leur version.
- **Garde des requêtes** (`guard.py`, relue par WTF4) : `Host` local pour
  tout (API et fichiers), `Origin` local s'il est présent, JSON exigé pour
  les écritures et `/api/run` (vérifié après le routage : une route
  inconnue reste un 404). L'enfant reçoit un environnement minimal ; au
  dépassement de temps, l'arbre de processus est tué (`taskkill /T`).
  Ce n'est pas un bac à sable : le code a les droits de l'utilisateur.
- **Pas de profil Claude** (décision de Baptiste le 2026-10-06). Les briques
  de départ et deux formules (loi normale, loi de Student), d'abord signées
  « Claude » (CL), sont passées au nom de Baptiste (BD). Ce que Claude écrit
  dans le corpus n'est plus signé Claude.

- **Ouvrable en double-clic (`file://`).** Le navigateur y bloque les
  modules ES et `fetch()` : scripts classiques, données en `.js`, fichiers
  chargés à la demande par injection de `<script>`.
- **Contenu de programme = PDFs, cité.** Exigence de Baptiste. Nos propres
  contenus sont séparés (`notes/` : fiches et corpus). Rédiger un cours à
  partir de rien a été proposé le 2026-10-01 et n'est pas tranché : ne pas
  le faire sans accord.
- **Ordre officiel des livres**, choix de Baptiste.
- **Couleurs des graphiques** validées avec le validateur du skill dataviz
  sur les surfaces du site (`#ffffff`, `#1b2238`), voir l'en-tête de
  `style.css`.
- **Couleurs des types d'entrée** validées de la même façon le
  2026-10-01 : emplacements 1, 2, 3, 7 et 5 de la palette de référence,
  pastille à côté d'un texte encre (jamais du texte coloré). Une seule
  source par support : `--etype-*` dans `style.css`, `types-entree` dans
  `notes/_gabarit.typ` (même ordre, mêmes valeurs claires).
- **Profil = simple repère**, pas de comptes. Pour regarder la sauvegarde
  de quelqu'un d'autre : fenêtre de navigation privée.
- **Sauvegarde restée en version 1** malgré les champs ajoutés (profil,
  réponses, marques, séries, questions traitées) : les champs absents sont tolérés au
  chargement, un fichier sans profil garde le profil courant.
- **Jamais publié en ligne** (droits AnalystPrep), à l'exception du dépôt
  GitHub privé (décision de Baptiste le 2026-10-02, « pour l'instant »).
- **Projet uv indépendant** (`prep-frm`), convention fixée le 2026-10-01,
  voir la Règle n°6 de `.claude/CLAUDE.md`.
- **Serveur local depuis le 2026-10-01** (`Lancer Prep FRM.bat`,
  127.0.0.1:8765) pour l'éditeur de fiches et, plus tard, les
  simulations. La lecture reste possible en double-clic, éditer non.
- **Conventions d'erreurs et d'API reprises de WorldTradeFinance4** à la
  demande de Baptiste (relu par une session WTF4 le 2026-10-01). Un échec
  de compilation Typst est une erreur métier : 422 `TYPST_COMPILE_ERROR`,
  avec `line`, `hints`, `explanation`, `saved` en extensions, jamais 200.
- **Le front construit les URL `/api/notes/<reading>/<author>`,
  `/api/corpus`, `/api/corpus/<id>`, `/api/corpus/<id>/<author>`,
  `/api/corpus/<id>/questions/<q>`, `/api/images` et `/api/math-tools`** (le
  reste vient des `links`) : si une route change, changer aussi
  `assets/js/editor/api.js`.
- **Une fiche par personne**, nommée d'après le prénom du profil ; la
  fusion éventuelle se fait à la main avec git.
- **Enregistrer n'échoue jamais sur le texte** : la source est écrite
  avant la compilation ; en cas d'erreur, l'ancien rendu reste.
- **Aucune boucle d'import possible dans le corpus, par construction.**
  Une entrée n'importe que `_corpus-titres.typ` (titres seuls) ; le
  serveur refuse `_corpus.typ` ou `#entree(` dans une entrée (422
  `CORPUS_IMPORT_FORBIDDEN`). `_corpus.typ` cache chaque version derrière
  une closure et n'est importé que par les fiches.
- **Une version qui ne compile pas est enregistrée mais exclue de
  `_corpus.typ`** (`valide: false`) : elle ne casse jamais la fiche d'un
  autre. 422 `TYPST_COMPILE_ERROR` avec `saved: true`, comme les fiches.
- **Changer une entrée recompile ses dépendants dans la requête**, hors
  du verrou du corpus, plafonné à `MAX_SYNC_REBUILDS` (20). Leurs échecs
  sont rapportés dans `rebuild` (aussi dans le 422 d'une version cassée),
  jamais levés. Rétroliens trouvés par regex : affichage seulement.
  Relu par la session WTF4 le 2026-10-01.
- **Entrées enregistrées à la demande** (bouton, Ctrl+S, alerte avant de
  quitter), pas pendant la frappe comme les fiches : une version
  enregistrée est aussitôt partagée et recompile les fiches qui
  l'insèrent (choisi le 2026-10-01).
- **Identifiant d'entrée fixé à la création** (proposé depuis le titre) ;
  titre et type modifiables par tous. Initiales = premières
  lettres du prénom et du nom du profil.
- **Readings d'une entrée = ceux des fiches qui la citent ou l'insèrent
  directement**, jamais saisis ni stockés (choix de Baptiste le
  2026-10-01 : on crée une entrée pour une fiche, et ça pousse à faire
  les fiches). Une citation par une autre entrée ne rattache pas.
  Le service des fiches prévient le corpus après chaque enregistrement,
  même raté (`NotesService.on_saved`, câblé dans `server.py`) : relu par
  la session WTF4 le 2026-10-01.
- **Le menu « Formules FRM » a été remplacé par le corpus** le 2026-10-01 :
  ses 6 formules sont des entrées signées BD, sans reading tant
  qu'aucune fiche ne les utilise.
- **Hypothèses et limites : formules seulement, dans l'encadré partout.**
  Choix de Baptiste le 2026-10-02. Deux fichiers Typst par version, deux champs
  sous le texte dans `entree.html`, rendus par `bloc-entree` sur la page du corpus
  et dans les fiches (`_corpus.typ` les inclut). Un champ vide supprime son fichier,
  un champ non envoyé n'est pas touché. Ils comptent comme le texte pour les
  citations, l'interdiction d'insérer et la validité d'une version.
- **Une erreur dit quel texte la porte.** Trois textes, une seule boîte : en cas
  d'échec, le serveur compile chaque texte seul ; `part` et `line` (dans ce texte)
  vont dans le 422, et l'éditeur marque le bon champ.
- **Images : dossier commun `notes/images/`, jamais remplacées.** Choix de
  Baptiste le 2026-10-02 (« ça force à bien nommer »). Chemin depuis la racine
  Typst (`/images/…`) : marche dans une fiche, une entrée, une entrée insérée.
  Compressées dans le navigateur (1600 px, PNG ou JPEG), envoyées en base64
  dans du JSON (la garde n'est pas touchée) ; requêtes portées à 6 Mo.
- **Supprimer une entrée retire ses références** (choix de Baptiste le
  2026-10-06) : `#voir` devient le titre échappé, `#entree` disparaît
  (`strip_references`). Fiches puis entrées réécrites et recompilées, sans
  plafond, avant l'effacement du dossier. Une brique importée est refusée
  (409 `BRICK_IN_USE`). Le gestionnaire lit le corps des DELETE (JSON exigé).
- **Questions liées au corpus, dans `entree.json`** (choix de Baptiste le
  2026-10-06) : partagées, écrites par PUT/DELETE
  `/api/corpus/<id>/questions/<q>`, lues par le manifeste. Distinctes de
  « Traitée ». Elles ne donnent pas de reading à l'entrée. La page Questions
  importe le menu Corpus des éditeurs (modules ES) à la demande, serveur seul.
  Séries : portée « entries », « Au moins une » (union) ou « Toutes » (croisement).
- **Boutons de maths ajoutés depuis les éditeurs, partagés** (choix de
  Baptiste le 2026-10-07) : `notes/_outils-maths.json`, sans notion
  d'auteur, tout le monde ajoute et retire. Les boutons de base restent dans
  `toolbar.js` ; `Var` et `Cov` y insèrent `op("…")` (Typst n'en a pas).

## Pièges rencontrés

**Deux fenêtres normales partagent le même stockage.** Charger une
sauvegarde dans l'une resynchronise l'autre (événement `storage`) ; pour
comparer deux sauvegardes, ouvrir la seconde en navigation privée (constaté
le 2026-09-30).

**La rampe bleue du mode sombre ratait le contraste.** La surface sombre du
site (`#1b2238`) est plus claire que celle prévue par le skill dataviz ; la
rampe a été décalée d'un cran (constaté le 2026-09-30).

**Chrome headless lancé depuis Git Bash ne produit pas de capture.**
`--screenshot` n'écrit rien (chemins réécrits par Git Bash) : lancer Chrome
depuis PowerShell. Un téléchargement bloque aussi Chrome headless :
intercepter le clic dans les tests (constaté le 2026-09-30).

**La bibliothèque Python `typst` ne donne pas la position des erreurs.**
`TypstError` n'a que `message`, `hints` et `trace` vide, même avec
`pretty=True` (version 0.15, constaté le 2026-10-01). Le serveur
retrouve la ligne : le nom inconnu dans la source, sinon le plus court
début de texte qui échoue avec le même message.

**La progression change d'un mode d'ouverture à l'autre.** Le
`localStorage` est propre à chaque origine : `file://` et
`http://127.0.0.1:8765` (ou un autre port) ne partagent rien ; passer
par une sauvegarde JSON (constaté le 2026-10-01).

**Un chemin avec espace casse la sortie d'esbuild.** `new URL(…).pathname`
garde `Prep%20FRM` : le premier regroupement de CodeMirror a été écrit
dans un dossier `Concours/FRM/Prep%20FRM/` ; utiliser `fileURLToPath`
(constaté le 2026-10-01).

**Une méthode HTTP non prévue renvoyait la page HTML 501 de Python.**
`SimpleHTTPRequestHandler` ne gère que GET et HEAD : DELETE et PATCH
passent désormais par l'API pour répondre en problem details (trouvé par
les tests le 2026-10-01).

**`--virtual-time-budget` fausse les tests de l'éditeur.** Chrome
headless accélère les minuteries mais pas le réseau : les délais
d'attente expirent avant les réponses du serveur. Piloter Chrome en
temps réel par le protocole DevTools (constaté le 2026-10-01).

**`"%~dp0"` casse les arguments d'un `.bat`.** `%~dp0` se termine par
`\`, qui échappe le guillemet fermant : `uv run --project "%~dp0" …`
recevait des arguments mélangés et ne trouvait pas `server.py`. Le
lanceur fait d'abord `cd /d "%~dp0"`, puis `uv run python server.py`
(constaté le 2026-10-01).

**Citer avec le curseur avant les imports cassait la compilation.**
`#voir("…")` atterrissait au-dessus de la ligne `#import` ajoutée
automatiquement, et Typst refuse un nom utilisé avant son import. Le menu
Corpus replace désormais le curseur sous les imports (trouvé en test le
2026-10-01).

**Le rapport de recompilation se perdait quand la version échouait.**
`save_version` recompilait les dépendants puis relevait l'erreur sans le
rapport ; le 422 porte désormais `rebuild` (trouvé par la revue WTF4 le
2026-10-01).

**CodeMirror lit la saisie de façon asynchrone.** Dans un test CDP,
`execCommand("insertText")` suivi aussitôt d'un clic ailleurs laisse le
curseur de CodeMirror à son ancienne place : attendre ~300 ms avant de
cliquer (constaté le 2026-10-01).

**La première palette des types échouait au validateur.** Formule
`#2a78d6` et Définition `#1c5cab` étaient indiscernables (ΔE 9,8 en
vision normale) et Propriété `#3f7a5c` trop grise ; remplacée par une
palette validée (constaté le 2026-10-01).

**Changer `_gabarit.typ` ne recompile rien.** Les SVG des entrées et des
fiches gardent l'ancien rendu jusqu'à leur prochain enregistrement ; le
changement de palette a demandé de tout recompiler à la main par un
script ponctuel (constaté le 2026-10-01).

**Un lien `#notes-card` ne descendait pas jusqu'à la fiche.** La page
Reading est construite par script, après que le navigateur a cherché
l'ancre : `reading.js` fait défiler lui-même une fois les fiches
affichées (constaté le 2026-10-01).

**Vérifier le type de contenu avant le routage masquait les 404.** Un
DELETE sur une route inconnue répondait 415 ; le contrôle JSON passe
désormais après `resolve` (trouvé par les tests le 2026-10-01).

**Tuer le processus Python laissait vivre ses enfants.** Sous Windows,
`subprocess.run(timeout=…)` ne tue que le premier processus ; un
`Popen` lancé par la simulation continuait. Groupe de processus +
`taskkill /T /F` (trouvé par la revue WTF4, testé le 2026-10-01).

**Les attributs `data-*` d'un menu entraient en collision avec ceux de la page.**
Les pages cherchent `document.querySelector("[data-preview]")` ; le menu Images,
placé avant dans la page, en avait un : l'aperçu de la fiche s'y écrivait, caché.
Les attributs des menus sont préfixés (`data-img-…`) (trouvé en test le 2026-10-02).

**Insérer avec le curseur en tête de fiche sortait du gabarit.** Le contenu placé
avant `#show: fiche.with(…)` échappe à la mise en page. Les menus Corpus et
Images placent le curseur sous tout l'en-tête (trouvé en test le 2026-10-02).

## Ce qui n'est pas en place

- **Bac à sable.** Le code exécuté peut lire les fichiers et accéder au
  réseau comme l'utilisateur ; acceptable tant que seuls les auteurs du
  corpus écrivent du code, à revoir pour un produit multi-utilisateur.
- **Exécution sans serveur.** Pas de Pyodide : en double-clic, le bouton
  est remplacé par l'invitation à lancer le `.bat`.
- **Renommage d'une entrée.** L'identifiant est fixé à la création : la
  supprimer puis la recréer (les citations deviennent du texte simple).
- **Fiche ouverte pendant une suppression.** Sa sauvegarde automatique remet
  la référence retirée ; la fiche ne compile plus jusqu'à correction.
- **Recompilation des fiches au démarrage.** Le serveur régénère les
  fichiers du corpus mais ne recompile pas les fiches : un dépendant
  `skipped` attend son prochain enregistrement.
- **Coloration du code Python.** L'éditeur de code n'a pas de mode
  Python (absent du CodeMirror regroupé).
- **Tests du front.** Seul le serveur a des tests automatisés ; les pages
  et les éditeurs ont été vérifiés à la main (Node, Chrome headless
  piloté par le protocole DevTools, scripts hors dépôt).
- **Autocomplétion Typst** (`sig` → `sigma`). Prévue comme possible, pas
  faite : la barre « Mode maths » couvre le besoin pour l'instant.
- **Questions sans réponse en examen.** Non enregistrées : elles comptent
  dans le score de la série mais n'apparaissent pas quand on la revoit.
- **Mode sombre des fiches Typst.** Abandonné par Baptiste le 2026-10-01.
- **Hypothèses et limites hors formules.** Propriété et théorème n'en ont pas
  (écarté par Baptiste le 2026-10-02).
- **Repérage des formules sans hypothèses ni limites.** Aucun indicateur ni
  statistique dans le corpus : seul le rendu montre l'absence.
- **Suppression ou renommage d'une image.** Aucune route : à la main dans
  `notes/images/`, puis corriger les `#image` qui la citent.
- **Suivi des usages d'une image.** Rien n'indique quelles fiches l'utilisent.
