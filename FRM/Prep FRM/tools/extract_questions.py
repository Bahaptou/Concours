"""Extrait les questions AnalystPrep des banques CH_*_AP.pdf vers data/questions/rN.js.

Un fichier par reading (N = numéro global du reading, comme reading.html?id=N),
chargé à la demande par le site. Chaque question garde sa page d'origine pour
renvoyer au PDF : le texte extrait perd les exposants et aplatit certaines
fractions ou petits tableaux, le PDF reste la référence.

    python tools/extract_questions.py

Structure d'une question :
    { "id": "315", "page": 3,
      "stem": [blocs], "options": { "A": [blocs], …, "D": [blocs] }, "answer": "A",
      "explanation": [blocs], "remember": ["…"] }
Un bloc vaut { "type": "p", "text": "…" } (paragraphe) ou { "type": "pre", "text": "…" }
(calcul ou tableau, mise en page d'origine conservée).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # pas de __pycache__ dans tools/ pour l'import ci-dessous
from extract_curriculum import BOOKS, PREP_DIR, read_pages  # noqa: E402

OUTPUT_DIR = PREP_DIR / "data" / "questions"
CURRICULUM = PREP_DIR / "data" / "curriculum.js"

READING = re.compile(r"^Reading (\d+):")
QUESTION = re.compile(r"^\s*Q\.\s?(\d+)\s*(.*)$")
OPTION = re.compile(r"^\s*([A-D])\.(?:\s+(.*))?$")
ANSWER = re.compile(r"^The correct answer is ([A-D])\b")
REMEMBER = "Things to Remember"
TERMINAL_PUNCTUATION = (".", ":", "?", "!")
LAYOUT_INDENT = 6  # au-delà, ligne de calcul ou de tableau à garder telle quelle


# ---------------------------------------------------------------- flux de lignes


def is_copyright(line: str) -> bool:
    return bool(re.match(r"^©\s*20\d\d", line.strip()))


def page_body(page: str) -> list[str]:
    """Lignes d'une page sans copyright ni numéro de page (en bas de page)."""
    lines = [l.rstrip() for l in page.splitlines() if not is_copyright(l)]
    while lines and (not lines[-1].strip() or lines[-1].strip().isdigit()):
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    return lines


def line_stream(pages: list[str]):
    """(page, ligne) sans le mobilier de page. Un paragraphe coupé par un saut de page
    est recollé ; sinon une ligne vide marque la frontière."""
    pending: list[tuple[int, str]] = []
    for page_no, page in enumerate(pages, 1):
        lines = page_body(page)
        if pending:
            while pending and not pending[-1][1].strip():
                pending.pop()
            if pending and pending[-1][1].strip().endswith(TERMINAL_PUNCTUATION):
                pending.append((page_no, ""))
            yield from pending
        pending = [(page_no, l) for l in lines]
    yield from pending


# ---------------------------------------------------------------- mise en blocs


def is_layout(line: str) -> bool:
    indent = len(line) - len(line.lstrip())
    return indent >= LAYOUT_INDENT or bool(re.search(r"\S {3,}\S", line.strip()))


def join_prose(lines: list[str]) -> str:
    text = ""
    for line in (l.strip() for l in lines):
        if text.endswith("-") and len(text) > 1 and text[-2].isalpha():
            text += line
        else:
            text = f"{text} {line}" if text else line
    return re.sub(r"\s+", " ", text)


def dedent(lines: list[str]) -> str:
    margin = min(len(l) - len(l.lstrip()) for l in lines)
    return "\n".join(l[margin:] for l in lines)


def to_blocks(lines: list[str]) -> list[dict]:
    """Paragraphes pour la prose, blocs préformatés pour les calculs et tableaux."""
    blocks: list[dict] = []
    prose: list[str] = []
    layout: list[str] = []

    def flush_prose():
        if prose:
            blocks.append({"type": "p", "text": join_prose(prose)})
            prose.clear()

    def flush_layout():
        if layout:
            blocks.append({"type": "pre", "text": dedent(layout)})
            layout.clear()

    for line in lines:
        if not line.strip():
            flush_prose()  # une ligne vide ne coupe pas un bloc de calcul
        elif is_layout(line):
            flush_prose()
            layout.append(line)
        else:
            flush_layout()
            prose.append(line)
    flush_prose()
    flush_layout()
    return blocks


def option_blocks(lines: list[str]) -> list[dict]:
    """Texte d'une option ; si la ligne « A. » est vide, le contenu (matrice, tableau)
    suit sur les lignes suivantes et garde sa mise en page."""
    first, rest = lines[0], [l for l in lines[1:] if l.strip()]
    if first.strip() or not rest:
        return [{"type": "p", "text": join_prose([first] + rest)}]
    return [{"type": "pre", "text": dedent(rest)}]


def remember_items(lines: list[str]) -> list[str]:
    """Points de « Things to Remember ». Les puces ont disparu du texte extrait : un point
    commence après une ligne vide, ou quand la ligne précédente finit une phrase et que la
    suivante commence par une majuscule."""
    items, current = [], []

    def flush():
        if not current:
            return
        text = join_prose(current)
        if items and not items[-1].endswith(TERMINAL_PUNCTUATION):
            items[-1] = f"{items[-1]} {text}"  # un point coupé en plusieurs blocs par la mise en page
        else:
            items.append(text)
        current.clear()

    for line in lines + [""]:
        stripped = line.strip()
        if not stripped:
            flush()
        elif current and current[-1].strip().endswith((".", "?", "!")) and stripped[0].isupper():
            flush()
            current.append(line)
        else:
            current.append(line)
    return items


# ---------------------------------------------------------------- questions


def parse_bank(filename: str) -> dict[int, list[dict]]:
    by_reading: dict[int, list[dict]] = {}
    reading = None
    question = None
    section = None  # stem | options | explanation | remember
    raw: dict[str, list[str]] = {}

    def finish():
        if question is None:
            return
        if question.get("answer") is None or sorted(question["options"]) != ["A", "B", "C", "D"]:
            sys.exit(f"{filename} : question Q.{question['id']} incomplète")
        question["stem"] = to_blocks(raw["stem"])
        question["explanation"] = to_blocks(raw["explanation"])
        question["remember"] = remember_items(raw["remember"])
        question["options"] = {k: option_blocks(v) for k, v in sorted(question["options"].items())}
        by_reading.setdefault(reading, []).append(question)

    for page_no, line in line_stream(read_pages(filename)):
        stripped = line.strip()
        header = READING.match(stripped)
        if header:
            finish()
            question, reading = None, int(header.group(1))
            continue
        start = QUESTION.match(line)
        if start and reading is not None:
            finish()
            question = {"id": start.group(1), "page": page_no, "options": {}, "answer": None}
            raw = {"stem": [start.group(2)], "explanation": [], "remember": []}
            section = "stem"
            continue
        if question is None:
            continue

        option = OPTION.match(line)
        expected = "ABCD"[len(question["options"])] if len(question["options"]) < 4 else None
        answer = ANSWER.match(stripped)
        if section in ("stem", "options") and option and option.group(1) == expected:
            section = "options"
            question["options"][option.group(1)] = [option.group(2) or ""]
        elif section == "options" and answer:
            question["answer"] = answer.group(1)
            section = "explanation"
        elif section == "options":
            if stripped:
                question["options"][max(question["options"])].append(line)
        elif stripped == REMEMBER and section == "explanation":
            section = "remember"
        else:
            raw[section].append(line)
    finish()
    return by_reading


# ---------------------------------------------------------------- écriture


def expected_counts() -> dict[int, int]:
    text = CURRICULUM.read_text(encoding="utf-8")
    curriculum = json.loads(text.split("FRM.curriculum = ", 1)[1].rstrip().rstrip(";"))
    return {r["id"]: r["questions"]["count"] for b in curriculum["books"] for r in b["readings"]}


def main() -> None:
    counts = expected_counts()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    seen_ids: set[str] = set()
    total = 0
    for _, title, bank_file in BOOKS:
        for reading, questions in parse_bank(bank_file).items():
            if len(questions) != counts[reading]:
                sys.exit(f"Reading {reading} : {len(questions)} questions extraites, {counts[reading]} attendues")
            duplicates = seen_ids & {q["id"] for q in questions}
            if duplicates:
                sys.exit(f"Identifiants de questions en double : {sorted(duplicates)}")
            seen_ids |= {q["id"] for q in questions}
            payload = json.dumps(questions, ensure_ascii=False, separators=(",", ":"))
            (OUTPUT_DIR / f"r{reading}.js").write_text(
                f"// Fichier GÉNÉRÉ par tools/extract_questions.py depuis {bank_file} : ne pas modifier à la main.\n"
                f"FRM.registerQuestions({reading}, {payload});\n",
                encoding="utf-8",
            )
            total += len(questions)
        print(f"{title:<32} ok")
    print(f"{total} questions -> {OUTPUT_DIR.relative_to(PREP_DIR)}")


if __name__ == "__main__":
    main()
