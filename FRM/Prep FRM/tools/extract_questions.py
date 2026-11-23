"""Extrait les questions AnalystPrep des banques CH_*_AP.pdf vers data/questions/rN.js.

Un fichier par reading (N = numéro global du reading, comme reading.html?id=N),
chargé à la demande par le site. Chaque question garde sa page d'origine pour
renvoyer au PDF, qui reste la référence.

Le texte de chaque page est mis en page ici, depuis la position des mots dans le PDF
(PyMuPDF), et non par pdftotext : les barres de fraction et les traits de tableau sont
des rectangles dessinés, que pdftotext ignore. On les redessine en « ─ », à leur place
entre numérateur et dénominateur ; une fraction simple (un mot court de chaque côté)
s'écrit en ligne, 1/3. Les tableaux gardent ainsi leurs lignes alignées.

    uv run python tools/extract_questions.py

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
import pymupdf  # noqa: E402
from extract_curriculum import BOOKS, PDF_DIR, PREP_DIR  # noqa: E402

OUTPUT_DIR = PREP_DIR / "data" / "questions"
CURRICULUM = PREP_DIR / "data" / "curriculum.js"

READING = re.compile(r"^Reading (\d+):")
QUESTION = re.compile(r"^\s*Q\.\s?(\d+)\s*(.*)$")
OPTION = re.compile(r"^\s*([A-D])\.(?:\s+(.*))?$")
ANSWER = re.compile(r"^The correct answer is ([A-D])\b")
REMEMBER = "Things to Remember"
TERMINAL_PUNCTUATION = (".", ":", "?", "!")
LAYOUT_INDENT = 6  # au-delà, ligne de calcul ou de tableau à garder telle quelle


# ---------------------------------------------------------------- mise en page depuis le PDF

BAR = "─"
CHAR_W = 4.6  # points per text column, close to pdftotext's grid for this 11 pt text
ROW_TOL = 3.0  # words whose vertical centres are this close share a row
PARAGRAPH_GAP = 18  # points between rows: lines are 13-14 apart, paragraphs 21 or more
SIMPLE = 8  # a numerator and a denominator this short (one word each) are written inline: 1/3


def bars_of(page) -> list[tuple[float, float, float]]:
    """(x0, x1, y) of the thin filled rectangles: fraction bars and table rules."""
    found = []
    for drawing in page.get_drawings():
        r = drawing["rect"]
        if drawing.get("fill") is not None and r.height <= 1.6 and 3 <= r.width <= 300:
            found.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
    return found


def inline_simple_fractions(items: list[tuple]) -> list[tuple]:
    """A bar with one short word just above and one just below, about as wide as them, becomes
    "num/den" on the text line: an option such as 1/3 stays on its line. A table rule is far
    wider than a cell, so it is left alone. A compound term gets parentheses: (Rm−Rf)/σm."""
    words = [it for it in items if it[0] == "w"]
    gone, added = set(), []

    def term(text: str) -> str:
        return f"({text})" if re.search(r"[^\s(]\s*[-+−∗×*/]", text) else text

    for bar in (it for it in items if it[0] == "b"):
        _, x0, x1, y, _ = bar
        over = lambda w: w[2] > x0 - 1 and w[1] < x1 + 1  # noqa: E731
        fits = lambda w: x1 - x0 <= (w[2] - w[1]) + 8  # noqa: E731
        num = [w for w in words if over(w) and y - 13 < w[3] < y - 1]
        den = [w for w in words if over(w) and y + 1 < w[3] < y + 13]
        if (
            len(num) == 1 and len(den) == 1
            and len(num[0][4]) <= SIMPLE and len(den[0][4]) <= SIMPLE
            and (fits(num[0]) or fits(den[0]))
            and not ({id(num[0]), id(den[0])} & gone)
        ):
            gone |= {id(bar), id(num[0]), id(den[0])}
            added.append(("w", x0, x1, y + 2, f"{term(num[0][4])}/{term(den[0][4])}"))
    return [it for it in items if id(it) not in gone] + added


def page_text(page) -> str:
    """The page as text laid out like pdftotext -layout, plus the bars drawn in the PDF."""
    words = page.get_text("words", flags=pymupdf.TEXTFLAGS_WORDS & ~pymupdf.TEXT_MEDIABOX_CLIP)
    if not words:
        return ""
    left = min(w[0] for w in words)  # the text's left margin is column 0
    # Overline marks (adjusted R², a mean) are drawn as rows of "¯" above the letter: left out,
    # they would make a line of their own in the middle of a sentence.
    items = [("w", w[0] - left, w[2] - left, (w[1] + w[3]) / 2, w[4]) for w in words if w[4].strip("¯")]
    items += [("b", x0 - left, x1 - left, y, None) for x0, x1, y in bars_of(page)]
    items = inline_simple_fractions(items)
    items.sort(key=lambda it: it[3])
    rows: list[list[tuple]] = []
    for item in items:
        if rows and abs(rows[-1][0][3] - item[3]) <= ROW_TOL:
            rows[-1].append(item)
        else:
            rows.append([item])
    out, last_y = [], None
    for row in rows:
        y = sum(it[3] for it in row) / len(row)
        if last_y is not None and y - last_y > PARAGRAPH_GAP:
            out.append("")
        last_y = y
        line: list[str] = []
        bars = [it for it in row if it[0] == "b"]
        for _, x0, x1, _, _ in bars:
            col, end = round(x0 / CHAR_W), max(round(x1 / CHAR_W), round(x0 / CHAR_W) + 1)
            line.extend(" " * (end - len(line)))
            line[col:end] = BAR * (end - col)
        ordered = sorted((it for it in row if it[0] == "w"), key=lambda it: it[1])
        gaps = [b[1] - a[2] for a, b in zip(ordered, ordered[1:])]
        # A justified line of prose: its wide spaces are not table columns.
        prose = not bars and len(ordered) >= 6 and max(gaps) < 18 and ordered[-1][2] - ordered[0][1] > 300
        cursor, prev_x1 = 0, None
        for _, x0, x1, _, text in ordered:
            if prev_x1 is not None and (prose or x0 - prev_x1 < 2 * CHAR_W):
                glued = not prose and x0 - prev_x1 < 0.8 and text[0] in ",.;:)]%"
                col = cursor if glued else cursor + 1  # one space between words, none before a comma
            else:
                col = max(round(x0 / CHAR_W), cursor + 1 if cursor else 0)
            prev_x1 = x1
            line.extend(" " * (col + len(text) - len(line)))
            line[col:col + len(text)] = text
            cursor = col + len(text)
        out.append("".join(line).rstrip())
    return "\n".join(out)


def bank_pages(filename: str) -> list[str]:
    """Text of each page of a question bank; index i is page i + 1."""
    with pymupdf.open(PDF_DIR / filename) as document:
        return [page_text(page) for page in document]


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

    for page_no, line in line_stream(bank_pages(filename)):
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
