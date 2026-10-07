# Prep FRM · Part I

Site local de préparation au FRM Part I. On le lance par **`Lancer Prep FRM.bat`** (double-clic) : un
petit serveur démarre et le navigateur s'ouvre sur l'accueil. Ouvrir `index.html` directement reste
possible pour lire, mais les éditeurs (fiches, corpus) ont besoin du serveur.

**Usage personnel.** Les questions sont extraites des banques AnalystPrep, dont la redistribution est
interdite : ne pas publier ce dossier en ligne (le dépôt GitHub privé fait exception) ni le partager
avec quelqu'un qui n'a pas les PDFs.

## Installation (une fois par machine)

1. Installer **uv** : dans PowerShell, `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`.
   Python n'est pas nécessaire : uv télécharge Python 3.13 tout seul.
2. Double-cliquer sur `Lancer Prep FRM.bat`. Au premier lancement, uv installe les dépendances
   (Typst, numpy, scipy, pandas, matplotlib : environ 150 Mo) ; les fois suivantes, le site s'ouvre
   tout de suite.

Garder la fenêtre noire ouverte pendant le travail ; la fermer arrête le serveur. Relancer le `.bat`
alors que le serveur tourne déjà rouvre simplement le navigateur dessus.

**Attention à la progression.** Le navigateur range la progression par adresse : celle du site ouvert
par le `.bat` (`http://127.0.0.1:8765`) n'est pas celle du site ouvert en double-clic sur `index.html`.
Pour passer de l'un à l'autre : 💾 Sauvegarder d'un côté, 📂 Charger de l'autre.

## Pages

- **Accueil** (`index.html`) : résumé, prochaine étape, les 4 livres, sauvegarde, repères, sources.
- **Dashboard** (`dashboard.html`) : avancement, confiance et réussite aux questions, filtrables par livre,
  par livre ou par reading. Chaque graphique a sa vue tableau.
- **Questions** (`quiz.html`) : séries de questions AnalystPrep, en entraînement (correction après chaque
  question) ou en examen (correction à la fin, compte à rebours possible), examen blanc réparti selon les
  poids d'examen, bilan et reprise des erreurs, historique des séries.
- **Question** (`question.html?reading=N&q=ID`) : une question hors de toute série : essai libre non
  enregistré, correction, marques, liens au corpus, historique (chaque essai et sa série). « S'entraîner »
  en fait une série d'une question, enregistrée.
- **Livre** (`livre.html?id=N`) et **Reading** (`reading.html?id=N`) : programme, étapes à cocher, note de
  confiance sur 4 par learning objective, « Things to Remember » et calculs des corrigés AnalystPrep
  (avec lien vers la page du PDF), suivi des questions, simulations Python, notre fiche (commune, avec qui
  l'a créée et modifiée), entrées du
  corpus rattachées au reading. La carte « Corpus de ce reading » a une recherche, le filtre de
  rattachement et le réglage « Entrées liées » (voir Corpus), et une vue Graphe ; chaque entrée dit si
  elle vient d'une fiche, de questions, ou des deux.
- **Corpus** (`corpus.html`, une entrée : `corpus.html?id=bayes`) : nos formules, définitions,
  propriétés, théorèmes et simulations. Vue **Liste** (tri par titre, usage ou date), vue **Graphe**
  (les entrées et leurs citations en flèches, livres de chaque entrée) et vue **Stats**
  (chiffres clés, entrées à surveiller, répartition par type, les plus utilisées avec une légende
  cliquable, code le plus complexe, tableau triable), avec les mêmes filtres :
  - **type, livre (ou « sans reading ») et contributeur** (qui a créé ou modifié l'entrée), à choix
    multiples : « Tous » sélectionne tout ; un
    clic quand tout est sélectionné ne garde que ce bouton, les suivants ajoutent ou retirent ;
  - **reading** : la liste ne propose que les readings des livres choisis ;
  - **rattachement** : Tout, Fiche ou questions, Fiche et questions, Pas encore dans une question, Pas
    encore dans une fiche, Ni fiche ni question, avec le nombre d'entrées de chaque option ; dans le
    reading choisi, sinon dans les livres choisis, sinon dans tout le programme (« Fiche ou questions »
    et « Ni fiche ni question » sont grisés quand un reading ou un livre est choisi) ;
  - **entrées liées** (Liste et Graphe) : ajoute, grisées, les entrées qui citent les résultats ou
    qu'ils citent (imports de code compris), jusqu'à N liens de distance ou toute la chaîne (Max) ;
  - recherche.

  Au survol d'une bulle du graphe ou d'un nom dans les Stats, un aperçu montre le début de l'entrée,
  avec un bouton pour l'ouvrir. Un clic sur une bulle la sélectionne, un clic à côté la relâche. Le
  graphe se parcourt comme une carte : glisser le fond pour se déplacer, molette (ou double-clic dans le
  vide) pour zoomer, boutons « Tout voir » et « 1:1 » en haut à droite.
- **Fiches** (`fiches.html`) : les 62 readings avec leurs étapes, leurs fiches et les entrées du corpus
  qu'elles citent ou insèrent ; filtres par livre, contributeur et type d'entrée (choix multiples, comme sur
  la page Corpus), état de la fiche (dont « fiche écrite mais ④ non cochée » et « ④ cochée sans
  fiche »), recherche d'un chapitre (« 10 » donne
  FRM-10, QA-10, FMP-10, VRM-10 ; ou un nom) et d'une entrée. Les pastilles ①②③④ en haut à droite
  trient par étape : cochés d'abord, puis non cochés d'abord, puis ordre officiel. Un clic ouvre la
  page du reading sur la fiche.
- **Éditeur de fiche** (`editeur.html?reading=N`, bouton « ✎ Éditer ma fiche » de la page Reading) et
  **éditeur d'entrée** (`entree.html`, `entree.html?id=bayes`).

Il n'y a pas de cours dans les PDFs du dossier `FRM/` (pas les livres GARP) : le contenu le plus proche
d'une fiche est l'encadré « Things to Remember » des corrigés. Les formules, elles, sont dans les calculs
des corrigés, repris tels quels dans la carte « Things to Remember » de chaque reading.

## Fiches (étape ④)

Chaque reading a **une fiche, commune** : chacun l'écrit et la modifie, en **Typst**, dans l'éditeur du
site (le profil 👤 sert seulement à dire qui l'a créée et qui l'a modifiée) :

- à gauche le texte, à droite l'aperçu, mis à jour pendant la frappe ;
- **Taille** (menu à côté de Italique, aussi dans l'éditeur d'entrée) entoure la sélection de
  `#text(size: …)[…]` : Petit, Grand, Très grand (en `em`, relatifs au texte de la fiche) ou Autre… pour
  taper sa valeur (`14pt`, `1.1em`). Sans effet sur les titres, dont la taille est fixée par le gabarit ;
- **∑ Maths** (Ctrl+M) entoure la sélection de `$…$` ; dès que le curseur est dans une formule, une
  barre « Mode maths » propose fraction, racine, exposant, indice, somme, lettres grecques… ;
- **＋ dans la barre « Mode maths »** : ajouter un bouton (libellé, Typst inséré, partie à sélectionner,
  aperçu). Les boutons ajoutés sont partagés (`notes/_outils-maths.json`) ; « × » au survol les retire,
  pour tout le monde ;
- **📚 Corpus** cherche une entrée du corpus (mêmes filtres que la page Corpus, entrées liées
  comprises) et la **cite** (`#voir("bayes")` : son titre, en couleur)
  ou l'**insère** (`#entree("bayes")` : l'entrée entière) ; la ligne `#import` nécessaire
  est ajoutée toute seule ;
- **🖼 Images** : colle une capture (Ctrl+V), glisse un fichier ou choisis-le ; l'image est compressée,
  nommée (nom obligatoire, commun à tous) et rangée dans `notes/images/`, puis `#image(…)` est inséré.
  Un nom pris ne se remplace pas ; le menu liste aussi les images existantes. Marche aussi dans les entrées.
- encadrés **À retenir**, **Piège**, **Définition** (définis dans `notes/_gabarit.typ`) ;
- une erreur affiche un bandeau avec sa ligne et une explication ; l'aperçu garde la dernière version
  valide ;
- enregistrement automatique (Ctrl+S pour tout de suite), même si la fiche contient une erreur : le
  texte n'est jamais perdu.

Fichiers : `notes/r<N>/fiche.typ` (la source), avec son rendu `fiche-<page>.svg` et `fiche.pdf`, et
`journal.jsonl` (qui l'a créée et modifiée, quand). La page Reading l'affiche, même sans serveur, avec
« Créée par … · modifiée par … ». Deux personnes qui modifient la même fiche sur deux machines auront un
conflit git en fusionnant : récupérer les changements de l'autre avant d'écrire.

## Corpus

Une bibliothèque commune que nous construisons nous-mêmes : **formules, définitions, propriétés,
théorèmes, simulations et briques de code**. Elle remplace l'ancien menu « Formules FRM » (ses 6
formules y sont, créées par BD). Tout y est commun : chacun crée, modifie et supprime les entrées.

- Chaque entrée a un **identifiant lisible** (`bayes`, fixé à la création), un type et un titre,
  communs à tous.
- **Ses readings ne se choisissent pas** : ce sont ceux des fiches qui la citent ou l'insèrent, et ceux
  des questions qui lui sont liées. Une entrée apparaît sur la page d'un reading dès qu'une fiche de ce
  reading s'en sert ou qu'elle est liée à une question de ce reading. Une citation par une autre entrée
  ne rattache pas.
- Une entrée a **un seul texte**, que chacun modifie. Son **historique** dit qui l'a créée et qui l'a
  modifiée, quand (« Créée par … · modifiée par … », et les initiales des contributeurs, le créateur
  d'abord) ; git garde les anciens textes.
- Une entrée peut en **citer** une autre (`#voir`), jamais l'insérer : c'est ce qui rend les boucles
  impossibles (A cite B, B cite A : aucun problème). Le serveur refuse une entrée qui tente d'insérer.
- Un texte qui ne compile pas est enregistré quand même (« ! » rouge dans le corpus), et les fiches
  gardent le **dernier texte qui compilait** jusqu'à correction : l'erreur de l'un ne bloque personne.
- Enregistrement **à la demande** (bouton ou Ctrl+S), pas pendant la frappe : le texte enregistré
  remplace celui de tout le monde et recompile les fiches qui l'insèrent. Le navigateur prévient avant de quitter
  une page non enregistrée. Si une fiche ou une entrée liée ne compile plus après un changement, l'éditeur
  le signale (son dernier rendu reste affiché).
- **Simulations et briques** : en plus de leur texte, elles ont une section de code Python à part (voir
  « Python » ci-dessous).
- **Hypothèses et limites des formules** : une formule a deux champs de plus sous son texte, écrits en
  Typst comme le reste. Ils s'affichent en deux petits blocs sous la formule,
  dans son encadré (hypothèses en cadre plein, limites en tirets), sur la page du corpus et dans les
  fiches qui insèrent la formule. Un champ vide n'affiche rien. Les autres types n'en ont pas.
- **Supprimer une entrée** : bouton dans l'éditeur d'entrée. Ses références sont retirées des fiches et
  des autres entrées (`#voir` devient son titre en texte simple, `#entree` disparaît) ; ces réécritures
  comptent comme des modifications de la personne qui supprime. Une brique encore
  importée par une simulation ne se supprime pas : retirer l'import d'abord.
- **Questions liées** : la page d'une entrée liste les questions qui lui sont liées (lien vers chacune)
  et propose une série sur ces questions. Les liens sont partagés comme le reste du corpus ; chacun
  rattache l'entrée au reading de la question.

Fichiers : `notes/corpus/<id>/entree.json` (type, titre, questions liées), `texte.typ` (le texte),
`hypotheses.typ` et `limites.typ` (une formule), `code.py` (le code d'une simulation ou d'une brique),
`page-<n>.svg` (le rendu), `journal.jsonl` (l'historique), `valide/` (le dernier texte qui compilait,
tant que le texte ne compile pas). Le serveur génère
`notes/_corpus-titres.typ` (titres, pour `#voir`), `notes/_corpus.typ` (textes qui compilent, pour
`#entree`) et `notes/corpus/index.js` (le corpus pour les pages ouvertes sans serveur) : ne pas les
modifier à la main.

## Python (étape ③)

- **▶ Exécuter**, sous chaque simulation (page Reading, page de l'entrée) et dans l'éditeur d'entrée sur
  le code en cours : le serveur lance le code avec le Python du projet (numpy, scipy, pandas,
  matplotlib) et affiche la sortie, l'erreur éventuelle avec sa ligne, et **les graphiques** : toute
  figure matplotlib ouverte à la fin est récupérée, pas besoin de `plt.show()`.
- **Limite de temps** réglable à côté du bouton (30 s par défaut, 300 s au plus), retenue par le
  navigateur. Au-delà, le calcul est arrêté, y compris les processus qu'il aurait lancés.
- **L'étape ③ se coche toute seule** quand une simulation s'exécute sans erreur, pour les readings de la
  simulation : ceux des fiches qui la citent ou l'insèrent, et ceux des questions qui lui sont liées.
- **Briques de code** : des fonctions réutilisables, entrées du corpus de type « Brique de code ». La
  brique `donnees-aleatoires` est le module `briques.donnees_aleatoires` :
  `from briques.donnees_aleatoires import generate_random_data`. Dans l'éditeur, le menu **🧱 Briques**
  du panneau de code ajoute la ligne d'import. Chaque brique a un seul code, commun. Le bloc
  `if __name__ == "__main__":` d'une brique est sa démonstration, lancée par ▶ Exécuter sur la brique
  elle-même. Briques de départ : données aléatoires, trajectoires de prix,
  rendements de portefeuille, histogramme avec quantile, Monte-Carlo.
- **📌 Enregistrer comme image**, sous chaque figure : la figure rejoint les images, prête à insérer.
- **Sécurité** : le serveur ne répond qu'au site qu'il sert (une page d'un autre site ouverte dans le
  navigateur ne peut ni écrire ni exécuter de code), et le code ne voit pas l'environnement du serveur.
  Ce n'est pas un bac à sable : le code a les droits de l'utilisateur sur sa machine.

## Structure

```
Lancer Prep FRM.bat           lancement : uv run … server.py
server.py                     démarrage du serveur local (127.0.0.1:8765)
backend/                      serveur : erreurs, services (compilation Typst, fiches, corpus, exécution Python), couche HTTP
tests/                        tests du serveur (uv run pytest)
pyproject.toml · uv.lock      projet uv « prep-frm » (Python 3.13, dépendance typst)
index.html · dashboard.html · quiz.html · livre.html · reading.html · corpus.html · fiches.html   pages lisibles sans serveur
editeur.html · entree.html    éditeurs de fiche et d'entrée du corpus (serveur nécessaire)
assets/css/style.css          thème, couleurs des graphiques, éditeur
assets/js/*.js                scripts classiques partagés (store, core, questions, ui, save, profile, charts, runner…)
assets/js/pages/*.js          un script par page
assets/js/editor/*.js         modules des éditeurs (CodeMirror, langage Typst, barre d'outils, menu Corpus, gabarit, API)
assets/vendor/codemirror/     CodeMirror 6 regroupé en un fichier (licence MIT jointe)
data/curriculum.js            GÉNÉRÉ depuis les PDFs, ne pas modifier à la main
data/questions/rN.js          GÉNÉRÉ : questions du reading N, chargées à la demande
notes/                        nos fiches Typst, le gabarit commun et index.js (GÉNÉRÉ par le serveur)
notes/corpus/                 le corpus : une entrée par dossier, index.js GÉNÉRÉ
notes/images/                 images des fiches et des entrées (dossier commun)
save/                         sauvegardes JSON exportées depuis le navigateur
tools/extract_curriculum.py   générateur de data/curriculum.js
tools/extract_questions.py    générateur de data/questions/
tools/make_demo_save.py       générateur de save/exemple-demo.json (données fictives)
tools/vendor_codemirror/      regroupement de CodeMirror (npm + esbuild, maintenance uniquement)
```

## Règles

- **Programme = PDFs uniquement.** Titres, poids, résumés, learning objectives, pages, questions et
  corrigés viennent des générateurs de `tools/`, qui lisent les PDFs de `FRM/`. Chaque texte affiché
  cite son document et sa page. Le texte extrait perd les exposants et aplatit certaines fractions :
  chaque question renvoie à sa page du PDF, qui fait foi.
- **Nos ajouts sont séparés** : fiches et corpus dans `notes/` (simulations comprises : entrées de type
  simulation). N est le numéro global du reading (1 à 62), celui de `reading.html?id=N`.
- **Les pages restent lisibles en double-clic** : scripts classiques qui remplissent l'objet global
  `FRM`, sans modules ES ni `fetch()` (bloqués en `file://`). Seuls les éditeurs, qui ont besoin du
  serveur, utilisent des modules.
- **Couleurs des graphiques** validées avec le validateur du skill dataviz sur les surfaces du site,
  en clair et en sombre (voir l'en-tête de `style.css`).

## Questions

- Chaque réponse est enregistrée (choix, juste ou faux, temps, date, série) : plusieurs essais par
  question, statistiques par question, reading, livre et série.
- L'étape ② d'un reading se coche seule quand toutes ses questions ont été tentées au moins une fois
  (elle reste décochable à la main).
- Deux marques par question : « À revoir » et « Formule illisible ». Les séries peuvent viser les
  questions jamais vues, ratées au dernier essai, marquées ou non traitées.
- **✓ Traitée** : une question déjà exploitée (fiche, corpus). Dans le bilan d'une série : compteur,
  « Masquer les traitées », « Suivante non traitée ». Compte par reading sur la page Reading et au
  dashboard. Ce n'est pas une marque : une question traitée n'est pas « marquée ».
- **Catalogue** (onglet de la page Questions) : toutes les questions avec leurs propres chiffres (faite,
  justes, dernier essai, temps, séries, marques, liens au corpus), filtres, recherche et tri. Les totaux
  restent au dashboard.
- **📚 Corpus**, sous chaque question : la relier à des entrées du corpus (« Lier » / « Délier »,
  serveur nécessaire). Les entrées liées s'affichent en pastilles sous la question. « Nouvelle série »
  propose « Questions liées à des entrées du corpus » : chercher les entrées avec la barre du corpus
  (mêmes filtres que partout), les cocher ; les entrées choisies s'affichent en bas, avec × pour en
  retirer une ; puis « Au moins une » (union) ou « Toutes » (croisement).
- Repère de temps : 100 questions en 4 h, soit 2 min 24 par question (compte à rebours de l'examen).
- Une série en cours se reprend après un rechargement (elle n'est pas dans la sauvegarde).

## Sauvegarde

Ce qui est **commun** (fiches, corpus, liens entre questions et corpus, images, boutons de maths) vit dans
`notes/` et passe par git. Ce qui est **à chacun** (réponses, séries, marques, questions traitées,
confiance, étapes cochées) vit dans le `localStorage` du navigateur (clé `frm-part1.state.v1`) : vider
les données du site l'efface. D'où les boutons de l'en-tête de chaque page :

- **👤 Profil** : prénom et nom, un simple repère écrit dans la sauvegarde et dans le nom du fichier ;
  il dit aussi qui crée et modifie les fiches et les entrées (il en faut un pour écrire).
- **💾 Sauvegarder** : un fichier par export, `prep-frm_prenom-nom_AAAA-MM-JJ_HHhMM.json`.
  Chrome / Edge ouvrent « Enregistrer sous » : choisir `save/` la première fois, il est reproposé ensuite.
  Autres navigateurs : le fichier arrive dans Téléchargements, à ranger dans `save/`.
- **📂 Charger** : choisir un fichier de `save/` ; après confirmation (profil et date affichés), il remplace
  tout l'état. Un fichier sans profil garde le profil actuel.
- **🆕 Sauvegarde vierge** (Accueil) : tout effacer pour repartir de zéro.

Deux fenêtres normales du même navigateur partagent le même stockage. Pour regarder la sauvegarde de
quelqu'un d'autre sans perdre la sienne : fenêtre de **navigation privée** (Ctrl+Maj+N), stockage séparé.

Le format est décrit en tête de `assets/js/store.js`. Un fichier abîmé est filtré au chargement.

`save/exemple-demo.json` est une sauvegarde **fictive** (profil « Profil Démo », réponses, séries et marques
comprises) pour voir les graphiques remplis : la charger dans une fenêtre privée.

## Développement

```
uv run pytest                             # tests du serveur
uv run python tools/extract_curriculum.py # régénérer le programme (demande pdftotext, fourni avec Git for Windows)
uv run python tools/extract_questions.py  # régénérer les questions (idem)
uv run python tools/make_demo_save.py     # régénérer la sauvegarde de démonstration
```

Mettre à jour CodeMirror : dans `tools/vendor_codemirror/`, `npm install` puis `npm run build`.
