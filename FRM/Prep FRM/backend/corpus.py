"""Shared corpus: formulas, definitions, properties, theorems, simulations and code bricks written by us.

An entry has a readable, fixed identifier (``bayes``) and belongs to everyone: shared metadata
(type, title, linked questions, validity) in ``corpus/<id>/entree.json`` and one shared text,
``texte.typ``, plus ``code.py`` for a simulation or a brick, and ``hypotheses.typ`` / ``limites.typ``
for a formula (two small blocks shown under it, in the entry's box everywhere: corpus page and
notes). Its ``journal.jsonl`` (backend/journal.py) keeps who created and changed it, and when; git
keeps the texts. Entries cite each other with ``#voir("id")``; notes can also insert a whole entry
with ``#entree("id")``.

A brick is reusable Python code that simulations import: brick ``donnees-aleatoires`` is module
``briques.donnees_aleatoires`` (``from briques.donnees_aleatoires import generate_random_data``).

An entry's readings are not stored: they are those of the notes citing or inserting it directly,
and of the AnalystPrep questions linked to it (both origins are kept apart as well). Citations by
other entries do not count, or everything would end up attached to everything.

No import cycle is possible, by construction:
- ``_corpus-titres.typ`` holds titles only and imports nothing but the template; ``voir`` lives there;
- an entry may import it (and the template), never ``_corpus.typ``: checked before saving;
- ``_corpus.typ`` holds the texts behind closures (evaluated only when a note inserts the entry)
  and is imported by notes only.
A text that does not compile never breaks a note: when a change breaks an entry that compiled, the
texts that compiled are kept in ``corpus/<id>/valide/`` and ``_corpus.typ`` points there until the
entry compiles again (choice of Baptiste, 2026-10-07). An entry that never compiled is left out.

Back-links come from a regex over the sources: best effort, for display, never a safety check.
"""
from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

from backend import journal
from backend.compiler import TypstCompiler
from backend.errors import (
    BrickInUseError,
    CorpusImportForbiddenError,
    EntryExistsError,
    InvalidRequestError,
    StorageError,
    TypstCompileError,
    UnknownEntryError,
)
from backend.files import remove, remove_tree, write_atomic
from backend.journal import Contributor
from backend.notes import NotesService, NoteTarget, now_ms

ENTRY_TYPES = ("formule", "definition", "propriete", "theoreme", "simulation", "brique")
BRICK = "brique"
CODE_TYPES = ("simulation", BRICK)  # entries carrying Python code
SECTIONS = ("hypotheses", "limites")  # texts written under a formula, in this order
SECTION_TYPES = ("formule",)  # entries carrying them
BRICK_IMPORT = re.compile(r"^[ \t]*(?:from|import)[ \t]+briques\.([A-Za-z_]\w*)", re.MULTILINE)
CITATION = re.compile(r'#(voir|entree)\(\s*"([a-z0-9][a-z0-9-]*)"')
FORBIDDEN = re.compile(r"_corpus\.typ|#entree\(")
MAX_SYNC_REBUILDS = 20  # beyond this, dependents are reported instead of recompiled in the request
TEXT = "texte.typ"
CODE = "code.py"
VALID = "valide"  # sub-folder holding the last texts that compiled, while the entry does not
PAGE_FILE = re.compile(r"^page-(?P<page>\d+)\.svg$")


@dataclass(frozen=True)
class EntryMeta:
    type: str
    titre: str


@dataclass(frozen=True)
class EntryTexts:
    """What is written for an entry, as stored on disk (None: no such file)."""

    source: str | None
    code: str | None
    hypotheses: str | None
    limites: str | None


@dataclass(frozen=True)
class Entry:
    id: str
    meta: EntryMeta
    has_text: bool
    valid: bool  # its text compiled at the last save or rebuild
    pages: tuple[Path, ...]
    code: str | None  # simulations and bricks only
    journal: tuple[journal.Session, ...]
    cites: tuple[str, ...]  # entries cited by its texts
    used_by: tuple[NoteTarget, ...]  # notes citing or inserting it
    imports: tuple[str, ...] = ()  # bricks imported by its code
    questions: tuple[tuple[str, int], ...] = ()  # linked AnalystPrep questions: (question id, reading)

    @property
    def updated_at(self) -> int:
        return max((s.end for s in self.journal), default=0)

    @property
    def note_readings(self) -> tuple[int, ...]:
        """Readings of the notes citing or inserting the entry."""
        return tuple(sorted({note.reading for note in self.used_by}))

    @property
    def question_readings(self) -> tuple[int, ...]:
        """Readings of the AnalystPrep questions linked to the entry."""
        return tuple(sorted({reading for _, reading in self.questions}))

    @property
    def readings(self) -> tuple[int, ...]:
        """Readings the entry belongs to: those of the notes using it and of the questions linked to
        it (choice of Baptiste, 2026-10-07). Never chosen by hand; the two origins stay apart in
        note_readings / question_readings."""
        return tuple(sorted(set(self.note_readings) | set(self.question_readings)))


@dataclass(frozen=True)
class Dependents:
    entries: tuple[str, ...]  # entries whose texts cite the entry
    notes: tuple[NoteTarget, ...]  # notes citing or inserting the entry
    inserting_notes: tuple[NoteTarget, ...]  # notes inserting it (its content shows in them)


@dataclass
class RebuildReport:
    """What happened to the dependents. Their failures never fail the request that changed the entry."""

    rebuilt: list[str] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"rebuilt": self.rebuilt, "failed": self.failed, "skipped": self.skipped}


def typst_string(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def typst_dict(items: list[str], indent: int = 1) -> str:
    """Typst dictionary literal from "key: value," lines; ``(:)`` when empty."""
    if not items:
        return "(:)"
    pad = "  " * indent
    lines = "\n".join(pad + item for item in items)
    return f"(\n{lines}\n{'  ' * (indent - 1)})"


def module_name(entry_id: str) -> str:
    """Python module of a brick: ``donnees-aleatoires`` -> ``donnees_aleatoires``."""
    return entry_id.replace("-", "_")


def brick_imports(code: str) -> set[str]:
    """Brick ids imported by some code (``from briques.x import …`` or ``import briques.x``)."""
    return {module.replace("_", "-") for module in BRICK_IMPORT.findall(code)}


@dataclass(frozen=True)
class BrickSource:
    entry_id: str
    module: str
    code: str


def citations(source: str) -> set[tuple[str, str]]:
    """{(kind, id)} found in a source, kind being "voir" or "entree"."""
    return {(m[1], m[2]) for m in CITATION.finditer(source)}


MARKUP_SPECIAL = re.compile(r"([\\*_#$\[\]<>@`~])")  # characters with a meaning in Typst markup


def _call_end(text: str, open_paren: int) -> int:
    """Index just after the parenthesis closing the call opened at ``open_paren`` (strings skipped)."""
    depth, in_string, index = 0, False, open_paren
    while index < len(text):
        char = text[index]
        if in_string:
            if char == "\\":
                index += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return len(text)


def strip_references(source: str, entry_id: str, titre: str) -> tuple[str, int]:
    """Removes an entry's calls from a Typst source, for its deletion: ``#voir("id")`` becomes the
    title as plain text (escaped for markup), ``#entree("id", …)`` disappears, with its line when
    nothing else is on it. Returns (new source, number of calls removed)."""
    plain = MARKUP_SPECIAL.sub(r"\\\1", titre)
    edits = []  # (start, end, replacement), in order
    for match in CITATION.finditer(source):
        if match[2] != entry_id or (edits and match.start() < edits[-1][1]):
            continue
        start, end = match.start(), _call_end(source, match.start() + 1 + len(match[1]))
        if match[1] == "voir":
            edits.append((start, end, plain))
            continue
        line_start = source.rfind("\n", 0, start) + 1
        line_end = source.find("\n", end)
        line_end = len(source) if line_end == -1 else line_end
        if not source[line_start:start].strip() and not source[end:line_end].strip():
            start, end = line_start, min(line_end + 1, len(source))
        edits.append((start, end, ""))
    for start, end, replacement in reversed(edits):
        source = source[:start] + replacement + source[end:]
    return source, len(edits)


class CorpusService:
    def __init__(self, root: Path, compiler: TypstCompiler, notes: NotesService):
        self.root = root  # notes/, the Typst root
        self.entries_root = root / "corpus"
        self.compiler = compiler
        self.notes = notes
        # Own lock for entry files and generated corpus files; notes keep theirs. Readers of the
        # generated files are safe anyway: they are written atomically.
        self._writes = threading.Lock()

    # -------------------------------------------------------------- paths

    def folder(self, entry_id: str) -> Path:
        return self.entries_root / entry_id

    def meta_path(self, entry_id: str) -> Path:
        return self.folder(entry_id) / "entree.json"

    def source_path(self, entry_id: str) -> Path:
        return self.folder(entry_id) / TEXT

    def code_path(self, entry_id: str) -> Path:
        return self.folder(entry_id) / CODE

    def section_path(self, entry_id: str, section: str) -> Path:
        return self.folder(entry_id) / f"{section}.typ"

    def valid_folder(self, entry_id: str) -> Path:
        return self.folder(entry_id) / VALID

    @staticmethod
    def read_sections(folder: Path, entry_type: str) -> dict[str, str]:
        """Non-blank sections in ``folder`` (the entry's, or its valid copy), in display order. Empty
        for the types that do not carry sections: files left over from a change of type are
        ignored, not deleted."""
        found = {}
        for section in SECTIONS if entry_type in SECTION_TYPES else ():
            path = folder / f"{section}.typ"
            if path.exists() and (text := path.read_text(encoding="utf-8")).strip():
                found[section] = text
        return found

    def page_paths(self, entry_id: str) -> list[Path]:
        pages = [p for p in self.folder(entry_id).glob("page-*.svg") if PAGE_FILE.match(p.name)]
        return sorted(pages, key=lambda p: int(PAGE_FILE.match(p.name)["page"]))

    # -------------------------------------------------------------- reading

    def exists(self, entry_id: str) -> bool:
        return self.meta_path(entry_id).exists()

    def _read_raw(self, entry_id: str) -> dict:
        path = self.meta_path(entry_id)
        if not path.exists():
            raise UnknownEntryError(entry_id)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise StorageError(str(path), str(error)) from error

    def _write_raw(self, entry_id: str, raw: dict) -> None:
        try:
            write_atomic(self.meta_path(entry_id), json.dumps(raw, ensure_ascii=False, indent=2) + "\n")
        except OSError as error:
            raise StorageError(str(self.meta_path(entry_id)), str(error)) from error

    def _usage(self) -> dict[str, list[NoteTarget]]:
        """{entry id: notes citing or inserting it}, from one pass over the notes."""
        usage: dict[str, list[NoteTarget]] = {}
        for target, source in self.notes.sources():
            for entry_id in sorted({eid for _, eid in citations(source)}):
                usage.setdefault(entry_id, []).append(target)
        return usage

    def _entry(self, entry_id: str, raw: dict, usage: dict[str, list[NoteTarget]]) -> Entry:
        source_path = self.source_path(entry_id)
        has_text = source_path.exists()
        texts = [source_path.read_text(encoding="utf-8"), *self.read_sections(self.folder(entry_id), raw["type"]).values()] if has_text else []
        cites = {target for text in texts for kind, target in citations(text) if kind == "voir"}
        code_path = self.code_path(entry_id)
        code = code_path.read_text(encoding="utf-8") if code_path.exists() else None
        return Entry(
            id=entry_id,
            meta=EntryMeta(raw["type"], raw["titre"]),
            has_text=has_text,
            valid=has_text and raw.get("valide", True),
            pages=tuple(self.page_paths(entry_id)),
            code=code,
            journal=tuple(journal.read(self.folder(entry_id))),
            cites=tuple(sorted(cites - {entry_id})),
            used_by=tuple(sorted(usage.get(entry_id, []), key=lambda n: n.reading)),
            imports=tuple(sorted(brick_imports(code or "") - {entry_id})),
            questions=tuple((q["id"], q["reading"]) for q in raw.get("questions", [])),
        )

    def get(self, entry_id: str) -> Entry:
        return self._entry(entry_id, self._read_raw(entry_id), self._usage())

    def list(self) -> list[Entry]:
        usage = self._usage()
        ids = [path.parent.name for path in self.entries_root.glob("*/entree.json")]
        entries = [self._entry(entry_id, self._read_raw(entry_id), usage) for entry_id in ids]
        return sorted(entries, key=lambda e: e.meta.titre.lower())

    def load_texts(self, entry_id: str) -> EntryTexts:
        self._read_raw(entry_id)  # unknown entry -> 404

        def read(path: Path) -> str | None:
            return path.read_text(encoding="utf-8") if path.exists() else None

        return EntryTexts(
            source=read(self.source_path(entry_id)),
            code=read(self.code_path(entry_id)),
            hypotheses=read(self.section_path(entry_id, "hypotheses")),
            limites=read(self.section_path(entry_id, "limites")),
        )

    def _text_files(self, *, valid_copies: bool = False):
        """(entry id, path) of every Typst text of the entries; with ``valid_copies``, also of the
        texts kept in ``valide/``."""
        for path in sorted(self.entries_root.glob("*/*.typ")):
            yield path.parent.name, path
        if valid_copies:
            for path in sorted(self.entries_root.glob(f"*/{VALID}/*.typ")):
                yield path.parent.parent.name, path

    def dependents(self, entry_id: str) -> Dependents:
        entries = []
        for other, path in self._text_files():
            if other != entry_id and other not in entries and ("voir", entry_id) in citations(path.read_text(encoding="utf-8")):
                entries.append(other)
        notes, inserting = [], []
        for target, source in self.notes.sources():
            found = citations(source)
            if ("voir", entry_id) in found or ("entree", entry_id) in found:
                notes.append(target)
            if ("entree", entry_id) in found:
                inserting.append(target)
        return Dependents(tuple(entries), tuple(notes), tuple(inserting))

    # -------------------------------------------------------------- writing

    @staticmethod
    def _check_type(entry_id: str, entry_type: str) -> None:
        if entry_type == BRICK and not entry_id[0].isalpha():
            raise InvalidRequestError("id", "une brique est un module Python : son identifiant commence par une lettre")

    def brick_sources(self) -> list[BrickSource]:
        """Code of every brick, for a run: each brick has one shared code."""
        bricks = []
        for path in sorted(self.entries_root.glob("*/entree.json")):
            entry_id = path.parent.name
            if self._read_raw(entry_id)["type"] != BRICK or not self.code_path(entry_id).exists():
                continue
            bricks.append(BrickSource(entry_id, module_name(entry_id), self.code_path(entry_id).read_text(encoding="utf-8")))
        return bricks

    def importers(self, entry_id: str) -> list[str]:
        """Entries whose code imports this brick."""
        found = set()
        for path in self.entries_root.glob(f"*/{CODE}"):
            if path.parent.name != entry_id and entry_id in brick_imports(path.read_text(encoding="utf-8")):
                found.add(path.parent.name)
        return sorted(found)

    def create(self, entry_id: str, meta: EntryMeta, who: Contributor) -> tuple[Entry, RebuildReport]:
        self._check_type(entry_id, meta.type)
        with self._writes:
            if self.exists(entry_id):
                raise EntryExistsError(entry_id, self._read_raw(entry_id)["type"])
            self._write_raw(entry_id, {"type": meta.type, "titre": meta.titre})
            journal.record(self.folder(entry_id), who, now_ms(), creation=True)
            self._regenerate()
        # Notes or entries may already have cited this identifier (and failed): retry them.
        return self.get(entry_id), self._rebuild(entry_id, entries=True, all_notes=True)

    def link_question(self, entry_id: str, question_id: str, reading: int, linked: bool) -> Entry:
        """Links an AnalystPrep question to an entry (or unlinks it); idempotent. Stored in
        entree.json, shared like the rest of the corpus. Nothing to recompile: renderings do not
        show the links; only the manifest (corpus page, quiz page) changes. The link attaches the
        entry to the question's reading, like a note citing it does. Not a change of the entry's
        text: the journal is left alone."""
        with self._writes:
            raw = self._read_raw(entry_id)
            questions = [q for q in raw.get("questions", []) if q["id"] != question_id]
            if linked:
                questions.append({"id": question_id, "reading": reading})
            raw["questions"] = sorted(questions, key=lambda q: (q["reading"], int(q["id"])))
            if not raw["questions"]:
                del raw["questions"]
            self._write_raw(entry_id, raw)
            self._regenerate()
        return self.get(entry_id)

    def update_meta(self, entry_id: str, meta: EntryMeta, who: Contributor) -> tuple[Entry, RebuildReport]:
        self._check_type(entry_id, meta.type)
        with self._writes:
            raw = self._read_raw(entry_id)
            raw.update(type=meta.type, titre=meta.titre)
            raw.pop("readings", None)  # stored by the first version of the corpus, now derived
            self._write_raw(entry_id, raw)
            journal.record(self.folder(entry_id), who, now_ms())
            self._regenerate()
        report = RebuildReport()
        self._rerender_into(entry_id, report)  # its box shows the type and the title
        # Citing entries and all notes show the title.
        return self.get(entry_id), self._rebuild(entry_id, entries=True, all_notes=True, report=report)

    def _current_texts(self, entry_id: str, entry_type: str) -> dict[str, str] | None:
        """The entry's texts as on disk ({"texte": …, "hypotheses": …}), None without a text."""
        if not self.source_path(entry_id).exists():
            return None
        return {"texte": self.source_path(entry_id).read_text(encoding="utf-8"), **self.read_sections(self.folder(entry_id), entry_type)}

    def _keep_valid(self, entry_id: str, texts: dict[str, str] | None) -> None:
        """Keeps ``texts`` (those that compiled) in ``valide/`` for the notes, unless a copy is
        already there: it is the last that compiled. Lock held."""
        folder = self.valid_folder(entry_id)
        if texts is None or (folder / TEXT).exists():
            return
        try:
            for name, text in texts.items():
                write_atomic(folder / f"{name}.typ", text)
        except OSError as error:
            raise StorageError(str(folder), str(error)) from error

    def _drop_valid(self, entry_id: str) -> None:
        """The entry compiles again: the notes use its texts, the copy goes. Lock held."""
        folder = self.valid_folder(entry_id)
        if folder.exists():
            try:
                remove_tree(folder)
            except OSError as error:
                raise StorageError(str(folder), str(error)) from error

    def save_text(
        self,
        entry_id: str,
        who: Contributor,
        source: str,
        code: str | None,
        hypotheses: str | None = None,
        limites: str | None = None,
    ) -> tuple[Entry, RebuildReport]:
        """Writes the entry's text. ``code``, ``hypotheses`` and ``limites`` left at None are not
        touched; a blank section removes its file (the block disappears)."""
        sections = {"hypotheses": hypotheses, "limites": limites}
        for text in (source, hypotheses, limites):
            if text is not None and FORBIDDEN.search(text):
                raise CorpusImportForbiddenError()
        failure = None
        with self._writes:
            raw = self._read_raw(entry_id)
            if code is not None and raw["type"] not in CODE_TYPES:
                raise InvalidRequestError("code", "le code Python est réservé aux simulations et aux briques")
            carries_sections = raw["type"] in SECTION_TYPES
            for section, text in sections.items():
                if text is not None and text.strip() and not carries_sections:
                    raise InvalidRequestError(section, "les hypothèses et les limites sont réservées aux formules")
            # The texts that compiled, in case this change breaks the entry.
            previous = self._current_texts(entry_id, raw["type"]) if raw.get("valide", True) else None
            try:
                write_atomic(self.source_path(entry_id), source)
                if code is not None:
                    write_atomic(self.code_path(entry_id), code)
                for section, text in sections.items():
                    if text is None:
                        continue
                    path = self.section_path(entry_id, section)
                    if text.strip():
                        write_atomic(path, text)
                    else:
                        remove(path)
            except OSError as error:
                raise StorageError(str(self.folder(entry_id)), str(error)) from error
            journal.record(self.folder(entry_id), who, now_ms())
            try:
                self._render(entry_id, raw, source)
                raw["valide"] = True
                self._drop_valid(entry_id)
            except TypstCompileError as error:
                raw["valide"] = False  # the notes keep the last texts that compiled (valide/)
                self._keep_valid(entry_id, previous)
                error.saved = True
                failure = error
            self._write_raw(entry_id, raw)
            self._regenerate()
        # The content changed: notes inserting the entry must be recompiled (citing ones only show the title).
        report = self._rebuild(entry_id, entries=False, all_notes=False)
        if failure:
            failure.rebuild = report.to_dict()  # the 422 carries the report too
            raise failure
        return self.get(entry_id), report

    def delete(self, entry_id: str, who: Contributor) -> RebuildReport:
        """Deletes an entry and its references: in the notes and the other entries, #voir becomes
        the title as plain text and #entree disappears (see strip_references); these rewritings are
        changes by ``who``, in the journals. What was rewritten is recompiled, its failures
        reported, never raised. A brick still imported by some code is refused: removing the
        import would break that code."""
        raw = self._read_raw(entry_id)  # unknown entry -> 404
        if raw["type"] == BRICK and (users := self.importers(entry_id)):
            raise BrickInUseError(entry_id, users)
        report = RebuildReport()
        # References first, while the entry still exists: an interruption leaves an unused entry,
        # never a note citing a missing one. Notes are saved even when they no longer compile.
        for target, source in list(self.notes.sources()):
            new_source, count = strip_references(source, entry_id, raw["titre"])
            if not count:
                continue
            try:
                self.notes.save(target, new_source, who)
                report.rebuilt.append(target.label)
            except TypstCompileError as error:
                report.failed.append({"target": target.label, "message": error.message})
        rewritten = []
        with self._writes:
            # The copies in valide/ too: a note may still show them.
            for other, path in self._text_files(valid_copies=True):
                if other == entry_id:
                    continue
                new_text, count = strip_references(path.read_text(encoding="utf-8"), entry_id, raw["titre"])
                if not count:
                    continue
                try:
                    write_atomic(path, new_text)
                except OSError as error:
                    raise StorageError(str(path), str(error)) from error
                if path.parent.name != VALID and other not in rewritten:
                    rewritten.append(other)
                    journal.record(self.folder(other), who, now_ms())
        for other in rewritten:
            self._rerender_into(other, report)
        with self._writes:
            try:
                remove_tree(self.folder(entry_id))
            except OSError as error:
                raise StorageError(str(self.folder(entry_id)), str(error)) from error
            self._regenerate()
        return report

    def preview(self, entry_type: str, titre: str, source: str, hypotheses: str | None = None, limites: str | None = None) -> list[str]:
        """SVG of an unsaved text, rendered in its box. Nothing is written."""
        texts = {"hypotheses": hypotheses, "limites": limites}
        for text in (source, *texts.values()):
            if text is not None and FORBIDDEN.search(text):
                raise CorpusImportForbiddenError()
        sections = {section: text for section, text in texts.items() if text is not None and text.strip()}
        return self._box_pages(entry_type, titre, source, sections)

    def regenerate(self) -> None:
        with self._writes:
            self._regenerate()

    # -------------------------------------------------------------- rendering

    @staticmethod
    def _wrapper(entry_type: str, titre: str, sections: dict[str, str] | None = None) -> tuple[str, str]:
        """(prelude, suffix) putting a source inside its box. The sections go in the prelude as
        named arguments: ``bloc-entree`` draws them under the body."""
        arguments = "".join(f", {section}: [\n{text}\n]" for section, text in (sections or {}).items())
        prelude = (
            '#import "/_gabarit.typ": bloc-entree, page-entree\n#show: page-entree\n'
            f"#bloc-entree({typst_string(entry_type)}, {typst_string(titre)}{arguments})[\n"
        )
        return prelude, "\n]\n"

    def _box_pages(self, entry_type: str, titre: str, source: str, sections: dict[str, str]) -> list[str]:
        """SVG pages of a text in its box (non-blank sections only, and only for the types that
        carry them). A text with sections that does not compile gets ``error.part``: each text is
        then compiled alone in the box to find the guilty one, whose own line numbers are reported."""
        sections = sections if entry_type in SECTION_TYPES else {}
        failure = None
        try:
            # With sections, a line found by searching the source alone would mean nothing: skip it.
            return self.compiler.svg_pages(source, wrapper=self._wrapper(entry_type, titre, sections), locate=not sections)
        except TypstCompileError as error:
            if not sections:
                raise
            failure = error
        alone = self._wrapper(entry_type, titre)
        for part, text in (("source", source), *sections.items()):
            try:
                self.compiler.svg_pages(text, wrapper=alone)
            except TypstCompileError as error:
                error.part = part
                raise
        raise failure  # every text compiles alone: the failure comes from how they fit together

    def _render(self, entry_id: str, raw: dict, source: str) -> None:
        """Write the SVG pages of the entry (lock held). Raises TypstCompileError."""
        sections = self.read_sections(self.folder(entry_id), raw["type"])
        pages = self._box_pages(raw["type"], raw["titre"], source, sections)
        try:
            for old in self.page_paths(entry_id)[len(pages):]:
                remove(old)
            for number, page in enumerate(pages, 1):
                write_atomic(self.folder(entry_id) / f"page-{number}.svg", page)
        except OSError as error:
            raise StorageError(str(self.folder(entry_id)), str(error)) from error

    def _rerender_into(self, entry_id: str, report: RebuildReport) -> None:
        """Re-render a saved entry (something it shows changed) and record the outcome; its validity
        follows, and its last texts that compiled are kept if it breaks. Not a change of its text:
        the journal is left alone.

        Takes the lock for this entry only: a batch of dependents is not one critical section,
        another write may interleave between two of them (harmless, each step is consistent)."""
        label = f"corpus/{entry_id}"
        with self._writes:
            if not self.exists(entry_id) or not self.source_path(entry_id).exists():
                return
            raw = self._read_raw(entry_id)
            current = self._current_texts(entry_id, raw["type"])
            try:
                self._render(entry_id, raw, current["texte"])
                raw["valide"] = True
                self._drop_valid(entry_id)
                report.rebuilt.append(label)
            except TypstCompileError as error:
                if raw.get("valide", True):
                    self._keep_valid(entry_id, current)  # they compiled until now
                raw["valide"] = False
                report.failed.append({"target": label, "message": error.message})
            self._write_raw(entry_id, raw)
            self._regenerate()

    def _rebuild(self, entry_id: str, *, entries: bool, all_notes: bool, report: RebuildReport | None = None) -> RebuildReport:
        """Recompile what depends on an entry, without ever failing the caller."""
        report = report or RebuildReport()
        deps = self.dependents(entry_id)
        tasks = [("entry", e) for e in deps.entries] if entries else []
        tasks += [("note", n) for n in (deps.notes if all_notes else deps.inserting_notes)]
        for kind, target in tasks:
            label = f"corpus/{target}" if kind == "entry" else target.label
            if len(report.rebuilt) + len(report.failed) >= MAX_SYNC_REBUILDS:
                report.skipped.append(label)
                continue
            if kind == "entry":
                self._rerender_into(target, report)
                continue
            try:
                self.notes.rebuild(target)
                report.rebuilt.append(label)
            except TypstCompileError as error:
                report.failed.append({"target": label, "message": error.message})
        return report

    # -------------------------------------------------------------- generated files

    def _regenerate(self) -> None:
        """Write _corpus-titres.typ, _corpus.typ and corpus/index.js (lock held)."""
        raws = {p.parent.name: json.loads(p.read_text(encoding="utf-8")) for p in sorted(self.entries_root.glob("*/entree.json"))}
        titles = [
            f"{typst_string(eid)}: (type: {typst_string(raw['type'])}, titre: {typst_string(raw['titre'])}),"
            for eid, raw in raws.items()
        ]
        texts = []
        for eid, raw in raws.items():
            if raw.get("valide", True) and self.source_path(eid).exists():
                texts.append(self._text_literal(eid, raw["type"], self.folder(eid), ""))
            elif (self.valid_folder(eid) / TEXT).exists():
                texts.append(self._text_literal(eid, raw["type"], self.valid_folder(eid), f"{VALID}/"))
        try:
            write_atomic(self.root / "_corpus-titres.typ", TITLES_TEMPLATE.format(titles=typst_dict(titles)))
            write_atomic(self.root / "_corpus.typ", CORPUS_TEMPLATE.format(texts=typst_dict(texts)))
            write_atomic(self.entries_root / "index.js", self._manifest(raws))
        except OSError as error:
            raise StorageError(str(self.root), str(error)) from error

    def _text_literal(self, entry_id: str, entry_type: str, folder: Path, prefix: str) -> str:
        """One entry in _corpus.typ: its texts behind closures (``none`` for a section it has not),
        read from ``folder``: the entry's, or its copy of the last texts that compiled."""
        sections = self.read_sections(folder, entry_type)

        def include(file_name: str) -> str:
            return f"() => include {typst_string(f'corpus/{entry_id}/{prefix}{file_name}')}"

        parts = [f"corps: {include(TEXT)}"]
        parts += [f"{section}: {include(f'{section}.typ') if section in sections else 'none'}" for section in SECTIONS]
        return f"{typst_string(entry_id)}: ({', '.join(parts)}),"

    def _manifest(self, raws: dict[str, dict]) -> str:
        """corpus/index.js: everything the site shows, readable from file:// pages."""
        usage = self._usage()
        entries = {eid: self._entry(eid, raw, usage) for eid, raw in raws.items()}
        cited_by: dict[str, list[str]] = {eid: [] for eid in entries}
        imported_by: dict[str, list[str]] = {eid: [] for eid in entries}
        for eid, entry in entries.items():
            for target in entry.cites:
                if target in cited_by:
                    cited_by[target].append(eid)
            for target in entry.imports:
                if target in imported_by:
                    imported_by[target].append(eid)
        payload = {
            eid: entry_to_dict(entry, self.root) | {"citedBy": cited_by[eid], "importedBy": imported_by[eid]}
            for eid, entry in entries.items()
        }
        return (
            "// GENERATED by the Prep FRM server: the corpus, for pages opened without the server. Do not edit by hand.\n"
            f"FRM.registerCorpus({json.dumps(payload, ensure_ascii=False, sort_keys=True)});\n"
        )


def entry_to_dict(entry: Entry, notes_root: Path) -> dict:
    """Plain representation shared by the API and the manifest. Page URLs are relative to the site root."""
    def url(path: Path) -> str:
        return "notes/" + path.relative_to(notes_root).as_posix()

    return {
        "id": entry.id,
        "type": entry.meta.type,
        "titre": entry.meta.titre,
        "readings": list(entry.readings),
        "noteReadings": list(entry.note_readings),
        "questionReadings": list(entry.question_readings),
        "cites": list(entry.cites),
        "imports": list(entry.imports),
        "usedBy": [{"reading": n.reading} for n in entry.used_by],
        "questions": [{"id": question, "reading": reading} for question, reading in entry.questions],
        "hasText": entry.has_text,
        "valid": entry.valid,
        "pages": [url(p) for p in entry.pages],
        "code": entry.code,
        "updatedAt": entry.updated_at,
        "journal": journal.as_dicts(list(entry.journal)),
    }


TITLES_TEMPLATE = """// GENERATED by the Prep FRM server: titles of the corpus entries. Do not edit by hand.
// Imported by entry versions: titles only, so that entries can cite each other without cycles.
#import "/_gabarit.typ": types-entree

#let corpus-titres = {titles}

#let voir(id) = {{
  if id not in corpus-titres {{ panic("Entrée inconnue du corpus : " + id) }}
  let entry = corpus-titres.at(id)
  let style = types-entree.at(entry.type)
  text(fill: style.couleur, weight: "semibold")[→ #entry.titre]
}}
"""

CORPUS_TEMPLATE = """// GENERATED by the Prep FRM server: the full corpus, for notes only. Do not edit by hand.
// Each text sits behind a closure: its file is evaluated only when a note inserts it. An entry
// whose text does not compile shows the last texts that did (corpus/<id>/valide/).
#import "/_gabarit.typ": bloc-entree
#import "/_corpus-titres.typ": corpus-titres, voir

#let corpus-textes = {texts}

// auteur: accepted for notes written when entries had one version per person; ignored.
#let entree(id, auteur: none) = {{
  if id not in corpus-titres {{ panic("Entrée inconnue du corpus : " + id) }}
  if id not in corpus-textes {{ panic("L'entrée " + id + " n'a encore aucun texte qui compile") }}
  let meta = corpus-titres.at(id)
  let texte = corpus-textes.at(id)
  bloc-entree(
    meta.type, meta.titre, (texte.corps)(),
    hypotheses: if texte.hypotheses != none {{ (texte.hypotheses)() }},
    limites: if texte.limites != none {{ (texte.limites)() }},
  )
}}
"""
