"""Extrait le programme FRM Part I des PDFs du dossier FRM/ vers data/curriculum.js.

Tout ce que le site affiche sur le programme (titres, poids, résumés, learning
objectives, pages, nombre de questions) vient d'ici : rien n'est saisi à la main.
À relancer si un PDF change :

    python "tools/extract_curriculum.py"

Dépendance : pdftotext (poppler), fourni avec Git for Windows.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

PREP_DIR = Path(__file__).resolve().parent.parent  # FRM/Prep FRM
PDF_DIR = PREP_DIR.parent  # FRM
OUTPUT = PREP_DIR / "data" / "curriculum.js"

STUDY_GUIDE = "frm-study-guide-26.pdf"
OBJECTIVES = "frm-learning-objective-26.pdf"

# Ordre officiel : (tag des learning objectives, titre du study guide, banque AnalystPrep)
BOOKS = [
    ("FRM", "Foundations of Risk Management", "CH_1_Foundations_of_Risk_Management_AP.pdf"),
    ("QA", "Quantitative Analysis", "CH_2_Quantitative_Analysis_AP.pdf"),
    ("FMP", "Financial Markets and Products", "CH_3_Financial_Markets_and_Products_AP.pdf"),
    ("VRM", "Valuation and Risk Models", "CH_4_Valuation_and_Risk_Models_AP.pdf"),
]

PDFTOTEXT_FALLBACK = Path(r"C:\Program Files\Git\mingw64\bin\pdftotext.exe")

LO_HEADER = re.compile(r"^Chapter (\d+)[.:]\s+(.+?)\s*\[([A-Z]+)\W(\d+)\]$")
BANK_HEADER = re.compile(r"^Reading (\d+):\s*(.*)$")
QUESTION = re.compile(r"^Q\.\s?\d+")
BULLET = "•"
SUB_BULLETS = ("- ", "– ")
TERMINAL_PUNCTUATION = (".", ":", "?", "!")


# ---------------------------------------------------------------- texte brut


def pdftotext() -> str:
    found = shutil.which("pdftotext")
    if found:
        return found
    if PDFTOTEXT_FALLBACK.exists():
        return str(PDFTOTEXT_FALLBACK)
    sys.exit("pdftotext introuvable : installer poppler ou Git for Windows.")


def read_pages(filename: str) -> list[str]:
    """Texte de chaque page du PDF ; l'indice i correspond à la page i + 1."""
    result = subprocess.run(
        [pdftotext(), "-layout", "-enc", "UTF-8", str(PDF_DIR / filename), "-"],
        capture_output=True,
        check=True,
    )
    pages = result.stdout.decode("utf-8").split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def is_footer(line: str) -> bool:
    """Pied de page GARP. Une note de bas de page (« * ... ») partage parfois sa ligne : on la garde."""
    line = line.strip()
    if line.startswith("*"):
        return False
    return "garp.org/frm" in line or line.startswith(("2026 FRM Learning Objectives", "2026 FRM Study Guide"))


def strip_footer(line: str) -> str:
    return re.sub(r"\s*garp\.org/frm.*$", "", line).strip()


def join_lines(lines: list[str]) -> str:
    """Recolle des lignes coupées par la mise en page, sans casser les mots composés."""
    text = ""
    for line in (l.strip() for l in lines):
        if not line:
            continue
        if text.endswith("-") and len(text) > 1 and text[-2].isalpha():
            text += line
        else:
            text = f"{text} {line}" if text else line
    return re.sub(r"\s+", " ", text)


def blocks(lines: list[str]) -> list[list[str]]:
    """Découpe en blocs séparés par des lignes vides."""
    result, current = [], []
    for line in lines:
        if line.strip():
            current.append(line)
        elif current:
            result.append(current)
            current = []
    if current:
        result.append(current)
    return result


def merge_split_paragraphs(paragraphs: list[str]) -> list[str]:
    """Un paragraphe coupé par un saut de page ne finit pas par une ponctuation."""
    merged: list[str] = []
    for paragraph in paragraphs:
        if merged and not merged[-1].endswith(TERMINAL_PUNCTUATION):
            merged[-1] = f"{merged[-1]} {paragraph}"
        else:
            merged.append(paragraph)
    return merged


def lines_between(lines: list[str], start: str, stop: str) -> list[str]:
    """Lignes strictement entre la première ligne commençant par `start` et celle commençant par `stop`."""
    stripped = [l.strip() for l in lines]
    begin = next(i for i, l in enumerate(stripped) if l.startswith(start)) + 1
    end = next(i for i in range(begin, len(stripped)) if stripped[i].startswith(stop))
    return lines[begin:end]


def page_lines(pages: list[str], first: int, last: int) -> list[str]:
    """Lignes des pages first..last (1-indexées), pieds de page retirés."""
    return [l for page in pages[first - 1 : last] for l in page.splitlines() if not is_footer(l)]


# ---------------------------------------------------------------- study guide


def parse_study_guide(pages: list[str]) -> dict:
    flat = [" ".join(p.split()) for p in pages]

    approach_page = next(i for i, p in enumerate(flat, 1) if "FRM Exam Approach" in p)
    approach_lines = lines_between(
        page_lines(pages, approach_page, approach_page), "FRM Exam Approach", "2026 FRM Curriculum"
    )

    books = {}
    for _, title, _ in BOOKS:
        page = next(
            i for i, p in enumerate(flat, 1) if "PART I EXAM WEIGHT" in p and title.upper() in p
        )
        weight = int(re.search(r"PART I EXAM WEIGHT \| (\d+)%", flat[page - 1]).group(1))
        last_page = page + 1  # chaque livre tient sur deux pages du study guide
        section = lines_between(
            page_lines(pages, page, last_page), "Topics and Readings", f"Readings for {title}"
        )

        intro, knowledge_points, summary = None, [], []
        for block in blocks(section):
            if block[0].strip().startswith(BULLET):
                knowledge_points += [l.strip().lstrip(BULLET).strip() for l in block]
            elif intro is None:
                intro = join_lines(block)
            elif not block[0].strip().startswith("To cover these broad knowledge points"):
                summary.append(join_lines(block))

        books[title] = {
            "weight": weight,
            "guide": {
                "source": "studyGuide",
                "page": page,
                "lastPage": last_page,
                "intro": intro,
                "knowledgePoints": knowledge_points,
                "summary": merge_split_paragraphs(summary),
            },
        }

    return {
        "examApproach": {
            "source": "studyGuide",
            "page": approach_page,
            "paragraphs": [join_lines(b) for b in blocks(approach_lines)],
        },
        "books": books,
    }


# ---------------------------------------------------------------- learning objectives


def objective_sections(pages: list[str]) -> dict[str, tuple[int, int]]:
    """Pages (début, fin) de chaque livre de la Part I, indexées par tag."""
    starts = []
    for i, page in enumerate(pages, 1):
        match = re.search(r"PART I EXAM WEIGHT \| \d+% \[(\w+)\]", page)
        if match:
            starts.append((match.group(1), i))
    last_start = starts[-1][1]
    part_two = next(i for i, p in enumerate(pages, 1) if i > last_start and "PART II" in p)
    ends = [start - 1 for _, start in starts[1:]] + [part_two - 1]
    return {tag: (start, end) for (tag, start), end in zip(starts, ends)}


def parse_objectives(pages: list[str]) -> dict[str, list[dict]]:
    readings_by_tag = {}
    for tag, (first, last) in objective_sections(pages).items():
        readings, current, target, footnote = [], None, None, None
        for page in range(first, last + 1):
            for raw in page_lines(pages, page, page):
                line = raw.strip()
                if not line or line.startswith("After completing this reading"):
                    continue
                if line.startswith("*"):
                    footnote = strip_footer(line.lstrip("*"))
                    continue
                header = LO_HEADER.match(line)
                if header:
                    chapter, title, header_tag, number = header.groups()
                    if header_tag != tag or int(number) != int(chapter):
                        sys.exit(f"En-tête incohérent dans {OBJECTIVES} p.{page} : {line}")
                    current = {"chapter": int(chapter), "tag": f"{tag}-{number}", "title": title, "page": page, "items": []}
                    readings.append(current)
                    target = None
                    continue
                if re.match(r"^Chapter \d+[.:]", line):
                    sys.exit(f"En-tête non reconnu dans {OBJECTIVES} p.{page} : {line}")
                if current is None:
                    continue  # couverture du livre et knowledge points : repris du study guide
                if line.startswith(BULLET):
                    target = {"text": line.lstrip(BULLET).strip()}
                    current["items"].append(target)
                elif line.startswith(SUB_BULLETS) and current["items"]:
                    parent = current["items"][-1]
                    target = {"text": line[2:].strip()}
                    parent.setdefault("sub", []).append(target)
                elif target is not None:
                    target["text"] = join_lines([target["text"], line])

        for reading in readings:
            reading["items"] = [
                {"text": item["text"], **({"sub": [s["text"] for s in item["sub"]]} if "sub" in item else {})}
                for item in reading["items"]
            ]
            if reading["title"].endswith("*"):
                reading["title"] = reading["title"].rstrip("*").strip()
                reading["note"] = footnote
        readings_by_tag[tag] = readings
    return readings_by_tag


# ---------------------------------------------------------------- banques AnalystPrep


def is_page_content(line: str) -> bool:
    """Faux pour les lignes de mise en page : vide, numéro de page, copyright."""
    line = line.strip()
    return bool(line) and not line.isdigit() and "AnalystPrep" not in line


def parse_bank(filename: str) -> dict:
    pages = read_pages(filename)
    cover = [l.strip() for l in pages[0].splitlines() if l.strip()]
    title = next(l for l in cover if l.startswith("Questions with Answers"))
    updated = next(l for l in cover if l.startswith("Last Updated:")).removeprefix("Last Updated:").strip()

    readings: dict[int, dict] = {}
    current = None
    for page_no, page in enumerate(pages, 1):
        content_seen = False
        for line in page.splitlines():
            stripped = line.strip()
            header = BANK_HEADER.match(stripped)
            if header:
                if current is not None:
                    current["lastPage"] = page_no if content_seen else page_no - 1
                current = {"apTitle": header.group(2), "firstPage": page_no, "count": 0}
                readings[int(header.group(1))] = current
            elif current is not None and QUESTION.match(stripped):
                current["count"] += 1
            content_seen = content_seen or is_page_content(line)
    current["lastPage"] = len(pages)

    return {"title": title, "updated": updated, "pages": len(pages), "readings": readings}


# ---------------------------------------------------------------- assemblage


def words(title: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", title.lower())) - {"and", "the", "of", "a", "an"}


def build() -> dict:
    study_guide_pages = read_pages(STUDY_GUIDE)
    objectives_pages = read_pages(OBJECTIVES)
    guide = parse_study_guide(study_guide_pages)
    objectives = parse_objectives(objectives_pages)

    sources = {
        "studyGuide": {"file": STUDY_GUIDE, "title": "2026 FRM Study Guide", "pages": len(study_guide_pages)},
        "objectives": {"file": OBJECTIVES, "title": "2026 FRM Learning Objectives", "pages": len(objectives_pages)},
    }
    books, next_id = [], 1
    for number, (tag, title, bank_file) in enumerate(BOOKS, 1):
        bank = parse_bank(bank_file)
        bank_key = f"bank{number}"
        sources[bank_key] = {"file": bank_file, "title": f"AnalystPrep — {bank['title']}", "updated": bank["updated"], "pages": bank["pages"]}

        readings = []
        for lo in objectives[tag]:
            reading_id = next_id
            next_id += 1
            questions = bank["readings"].get(reading_id)
            if questions is None:
                sys.exit(f"Reading {reading_id} ({lo['title']}) absent de {bank_file}")
            if not words(lo["title"]) & words(questions["apTitle"]):
                print(f"  ! titres éloignés pour le reading {reading_id} : {lo['title']!r} / {questions['apTitle']!r}")
            readings.append({
                "id": reading_id,
                "chapter": lo["chapter"],
                "tag": lo["tag"],
                "title": lo["title"],
                **({"note": lo["note"]} if "note" in lo else {}),
                "objectives": {"source": "objectives", "page": lo["page"], "items": lo["items"]},
                "questions": {
                    "source": bank_key,
                    "firstPage": questions["firstPage"],
                    "lastPage": questions["lastPage"],
                    "count": questions["count"],
                },
            })
        if len(readings) != len(bank["readings"]):
            sys.exit(f"{bank_file} : {len(bank['readings'])} readings contre {len(readings)} dans les objectives")

        books.append({"id": number, "tag": tag, "title": title, **guide["books"][title], "readings": readings})

    return {
        "generatedOn": date.today().isoformat(),
        "sources": sources,
        "examApproach": guide["examApproach"],
        "books": books,
    }


def main() -> None:
    curriculum = build()
    payload = json.dumps(curriculum, ensure_ascii=False, indent=2)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        "// Fichier GÉNÉRÉ par tools/extract_curriculum.py : ne pas modifier à la main.\n"
        "// Chaque valeur provient d'un PDF du dossier FRM/ (voir `sources`).\n"
        "window.FRM = window.FRM || {};\n"
        f"FRM.curriculum = {payload};\n",
        encoding="utf-8",
    )
    for book in curriculum["books"]:
        n_questions = sum(r["questions"]["count"] for r in book["readings"])
        n_objectives = sum(len(r["objectives"]["items"]) for r in book["readings"])
        print(f"{book['tag']:>3} · {book['title']:<32} {book['weight']:>2} % · "
              f"{len(book['readings']):>2} readings · {n_objectives:>3} LOs · {n_questions:>3} questions")
    print(f"-> {OUTPUT.relative_to(PREP_DIR)}")


if __name__ == "__main__":
    main()
