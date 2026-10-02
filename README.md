# Concours

Préparation de Baptiste à deux certifications financières : le **CFA** (Chartered Financial Analyst,
CFA Institute) et le **FRM** (Financial Risk Manager, GARP).

Le dépôt contient surtout des PDFs de cours et d'entraînement, et un seul projet de code :
**Prep FRM**, un site local de préparation au FRM Part I (suivi par reading, questions, fiches Typst,
corpus de formules, simulations Python).

> **Dépôt privé, PDFs sous droits.** Les PDFs viennent du CFA Institute, de Kaplan Schweser, de GARP et
> d'AnalystPrep, dont la redistribution est interdite. Usage personnel : ne pas rendre ce dépôt public
> ni le partager avec quelqu'un qui n'a pas déjà ces documents.

## Contenu

| Dossier | Contenu | Code |
|---|---|---|
| `CFA/Level1/` | Curriculum officiel CFA Level I 2025 (10 volumes), SchweserNotes 2025 (4 PDFs), lectures prérequises 2024 | Aucun |
| `FRM/` | FRM Part I 2026 : study guide, learning objectives, banques de questions AnalystPrep | `FRM/Prep FRM/` |

## Installation de Prep FRM

Prep FRM se lance sous **Windows** (lanceur `.bat`). Le code gère aussi Linux et macOS, mais ce n'est
pas testé.

1. **Git.** Installer [Git for Windows](https://git-scm.com/download/win) et avoir accès au dépôt
   (clé SSH ou `gh auth login`, le dépôt est privé).
2. **uv.** Dans PowerShell :
   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
   Python n'est pas nécessaire : uv télécharge Python 3.13 au besoin. Rouvrir le terminal ensuite.
3. **Cloner** (environ 80 Mo de PDFs) :
   ```powershell
   git clone git@github.com:Bahaptou/Concours.git
   ```
4. **Lancer** : double-cliquer sur `FRM/Prep FRM/Lancer Prep FRM.bat`, ou depuis un terminal :
   ```powershell
   cd "Concours/FRM/Prep FRM"
   uv run python server.py
   ```
   Au premier lancement, uv crée l'environnement et installe les dépendances (Typst, numpy, scipy,
   pandas, matplotlib). Le navigateur s'ouvre ensuite sur <http://127.0.0.1:8765>. Garder la fenêtre
   ouverte pendant le travail ; la fermer arrête le serveur.
5. **Vérifier** (facultatif) : `uv run pytest` dans `FRM/Prep FRM/` lance les tests du serveur
   (environ une minute).

Mettre à jour : `git pull`, puis relancer.

### Si ça ne marche pas

- **« uv n'est pas installé »** : rouvrir le terminal après l'installation d'uv.
- **Le port 8765 est pris** : le serveur en prend un autre (jusqu'à 8775) et l'affiche. Le navigateur
  range la progression par adresse : sur un autre port, elle semble vide. Charger une sauvegarde (📂).

### Sauvegarde de la progression

La progression vit dans le navigateur (`localStorage`), pas dans le dépôt. Le bouton 💾 Sauvegarder
écrit un fichier JSON à ranger dans `FRM/Prep FRM/save/` ; 📂 Charger le relit.

## Pour aller plus loin

Mode d'emploi du site, pages, fiches, corpus : [FRM/Prep FRM/README.md](FRM/Prep%20FRM/README.md).
