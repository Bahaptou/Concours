"""Génère save/exemple-demo.json : une sauvegarde FICTIVE pour voir les graphiques remplis.

Profil simulé : livre 1 presque fini, livre 2 bien entamé, livres 3 et 4 à peine
commencés ; notes de confiance et réussite aux questions d'autant plus basses que
le livre est peu avancé ; séries réparties sur septembre 2026, reprises des
erreurs, un examen blanc, quelques questions marquées. Tirage à graine fixe : le
fichier est identique à chaque exécution.

    python tools/make_demo_save.py
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

PREP_DIR = Path(__file__).resolve().parent.parent
CURRICULUM = PREP_DIR / "data" / "curriculum.js"
QUESTIONS_DIR = PREP_DIR / "data" / "questions"
OUTPUT = PREP_DIR / "save" / "exemple-demo.json"

STEPS = ["objectives", "questions", "simulation", "sheet"]
LETTERS = "ABCD"

# Par livre : nombre de readings ayant atteint chaque étape (None = tous), notes de
# confiance tirées au sort, part de LOs non notés, réussite au 1er essai, temps par question (s).
PROFILES = {
    1: {"steps": [None, None, 7, 5], "scores": [2, 3, 3, 4, 4], "unrated": 0.0, "success": 0.78, "seconds": (60, 150)},
    2: {"steps": [10, 8, 5, 3], "scores": [1, 2, 2, 3, 3, 4], "unrated": 0.15, "success": 0.62, "seconds": (90, 240)},
    3: {"steps": [6, 4, 1, 0], "scores": [0, 1, 1, 2, 2, 3], "unrated": 0.3, "success": 0.55, "seconds": (70, 180)},
    4: {"steps": [3, 1, 0, 0], "scores": [0, 0, 1, 1, 2], "unrated": 0.4, "success": 0.45, "seconds": (100, 260)},
}
START = datetime(2026, 9, 2, 18, 0, tzinfo=timezone.utc)


def load_js(path: Path, marker: str) -> object:
    text = path.read_text(encoding="utf-8")
    return json.loads(text.split(marker, 1)[1].rstrip().rstrip(";").rstrip(")"))


def question_ids(reading_id: int) -> list[dict]:
    path = QUESTIONS_DIR / f"r{reading_id}.js"
    return load_js(path, f"FRM.registerQuestions({reading_id}, ")


class Timeline:
    """Horloge des séries : environ deux séries par jour à partir du 2 septembre
    (la cinquantaine de séries tient avant la fin du mois)."""

    def __init__(self, rng: random.Random):
        self.rng = rng
        self.now = START

    def next_session(self) -> datetime:
        self.now += timedelta(hours=self.rng.choice([8, 10, 12, 14]))
        return self.now


def main() -> None:
    rng = random.Random(2026)
    curriculum = load_js(CURRICULUM, "FRM.curriculum = ")
    progress: dict[str, dict] = {}
    confidence: dict[str, dict] = {}
    attempts: list[dict] = []
    sessions: list[dict] = []
    clock = Timeline(rng)

    def run_session(label: str, mode: str, questions: list[tuple[dict, int]], success: float, seconds: tuple[int, int]):
        start = clock.next_session()
        session_id = f"s{int(start.timestamp() * 1000):x}"
        at, correct_count, total_ms = start, 0, 0
        for question, reading_id in questions:
            ms = rng.randint(*seconds) * 1000
            at += timedelta(milliseconds=ms)
            correct = rng.random() < success
            choice = question["answer"] if correct else rng.choice([l for l in LETTERS if l != question["answer"]])
            attempts.append({"q": question["id"], "reading": reading_id, "choice": choice, "correct": correct,
                             "ms": ms, "at": int(at.timestamp() * 1000), "session": session_id})
            correct_count += correct
            total_ms += ms
        sessions.append({"id": session_id, "mode": mode, "label": label, "startedAt": int(start.timestamp() * 1000),
                         "finishedAt": int(at.timestamp() * 1000), "total": len(questions), "answered": len(questions),
                         "correct": correct_count, "ms": total_ms, "timeLimit": None})

    for book in curriculum["books"]:
        profile = PROFILES[book["id"]]
        for rank, reading in enumerate(book["readings"]):
            key = str(reading["id"])
            done = {step: True for step, reached in zip(STEPS, profile["steps"]) if reached is None or rank < reached}
            if done:
                progress[key] = done
            if "objectives" not in done:
                continue
            scores = {str(i): rng.choice(profile["scores"]) for i in range(len(reading["objectives"]["items"]))
                      if rng.random() >= profile["unrated"]}
            if scores:
                confidence[key] = scores

            questions = [(q, reading["id"]) for q in question_ids(reading["id"])]
            label = f"{reading['tag']} · {reading['title']}"
            if "questions" in done:
                # Toutes les questions une fois (l'étape ② est alors cochée), puis reprise des erreurs.
                run_session(label, "training", questions, profile["success"], profile["seconds"])
                wrong_ids = {a["q"] for a in attempts[-len(questions):] if not a["correct"]}
                wrong = [(q, r) for q, r in questions if q["id"] in wrong_ids]
                if wrong:
                    run_session(f"{label} · erreurs", "training", wrong, min(0.9, profile["success"] + 0.2), profile["seconds"])
            else:
                # Reading commencé : une partie des questions seulement.
                run_session(f"{label} · jamais vues", "training", questions[: max(3, len(questions) // 3)], profile["success"], profile["seconds"])

    # Un examen blanc réduit (40 questions) réparti selon les poids d'examen.
    exam = []
    for book in curriculum["books"]:
        pool = [(q, r["id"]) for r in book["readings"] for q in question_ids(r["id"])]
        exam += rng.sample(pool, round(40 * book["weight"] / 100))
    rng.shuffle(exam)
    run_session("Examen blanc", "exam", exam, 0.58, (100, 170))
    sessions[-1]["timeLimit"] = len(exam) * 144_000

    seen = sorted({a["q"] for a in attempts}, key=int)
    flags = {qid: {"review": True} for qid in rng.sample(seen, 12)}
    for qid in rng.sample(seen, 4):
        flags.setdefault(qid, {})["unreadable"] = True

    save = {
        "app": "prep-frm",
        "version": 1,
        "exportedAt": "2026-09-30T12:00:00.000Z",
        "note": "Données FICTIVES générées par tools/make_demo_save.py, pour visualiser les graphiques.",
        "profile": {"firstName": "Profil", "lastName": "Démo"},
        "progress": progress,
        "confidence": confidence,
        "attempts": attempts,
        "flags": flags,
        "sessions": sessions,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(save, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    rated = sum(len(v) for v in confidence.values())
    print(f"{len(progress)} readings commencés, {rated} LOs notés, {len(attempts)} réponses, "
          f"{len(sessions)} séries, {len(flags)} questions marquées -> {OUTPUT.relative_to(PREP_DIR)}")


if __name__ == "__main__":
    main()
