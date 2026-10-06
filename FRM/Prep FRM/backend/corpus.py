"""Shared corpus: formulas, definitions, properties, theorems, simulations and code bricks written by us.

An entry has a readable, fixed identifier (``bayes``), shared metadata (type, title) in
``corpus/<id>/entree.json`` and one version per author: ``corpus/<id>/<author>.typ``, plus
``<author>.py`` for a simulation or a brick, and ``<author>.hypotheses.typ`` /
``<author>.limites.typ`` for a formula (two small blocks shown under it, in the entry's box
everywhere: corpus page and notes). Entries cite each other with ``#voir("id")``; notes
can also insert a whole entry with ``#entree("id")``.

A brick is reusable Python code that simulations import: brick ``donnees-aleatoires`` is module
``briques.donnees_aleatoires`` (``from briques.donnees_aleatoires import generate_random_data``).
At run time each brick resolves to the version of the running code's author, or another one
(see ``brick_sources``).

An entry's readings are not stored: they are those of the notes citing or inserting it directly
(an entry is written for a note). Citations by other entries do not count, or everything would
end up attached to everything.

No import cycle is possible, by construction:
- ``_corpus-titres.typ`` holds titles only and imports nothing but the template; ``voir`` lives there;
- an entry version may import it (and the template), never ``_corpus.typ``: checked before saving;
- ``_corpus.typ`` holds the versions behind closures (evaluated only when a note inserts the
  entry) and is imported by notes only.
A version that does not compile is left out of ``_corpus.typ`` until fixed, so it cannot break notes.

Back-links come from a regex over the sources: best effort, for display, never a safety check.
"""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

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
from backend.files import write_atomic
from backend.notes import NotesService, NoteTarget

ENTRY_TYPES = ("formule", "definition", "propriete", "theoreme", "simulation", "brique")
BRICK = "brique"
CODE_TYPES = ("simulation", BRICK)  # entries carrying Python code
SECTIONS = ("hypotheses", "limites")  # texts written under a formula, in this order
SECTION_TYPES = ("formule",)  # entries carrying them
BRICK_IMPORT = re.compile(r"^[ \t]*(?:from|import)[ \t]+briques\.([A-Za-z_]\w*)", re.MULTILINE)
CITATION = re.compile(r'#(voir|entree)\(\s*"([a-z0-9][a-z0-9-]*)"')
FORBIDDEN = re.compile(r"_corpus\.typ|#entree\(")
MAX_SYNC_REBUILDS = 20  # beyond this, dependents are reported instead of recompiled in the request
PAGE_FILE = re.compile(r"^(?P<author>[a-z0-9-]+)-(?P<page>\d+)\.svg$")


@dataclass(frozen=True)
class EntryMeta:
    type: str
    titre: str


@dataclass(frozen=True)
class Version:
    author: str
    name: str
    initials: str
    updated_at: int
    valid: bool  # last save compiled; invalid versions are left out of _corpus.typ
    pages: tuple[Path, ...]
    code: str | None  # simulations and bricks only


@dataclass(frozen=True)
class VersionFiles:
    """What an author wrote for an entry, as stored on disk (None: no such file)."""

    source: str | None
    code: str | None
    hypotheses: str | None
    limites: str | None


@dataclass(frozen=True)
class Entry:
    id: str
    meta: EntryMeta
    versions: tuple[Version, ...]
    cites: tuple[str, ...]  # entries cited by its versions
    used_by: tuple[NoteTarget, ...]  # notes citing or inserting it
    imports: tuple[str, ...] = ()  # bricks imported by its versions' code
    questions: tuple[tuple[str, int], ...] = ()  # linked AnalystPrep questions: (question id, reading)

    @property
    def readings(self) -> tuple[int, ...]:
        """Readings of the notes using the entry: the only way an entry gets attached to a reading."""
        return tuple(sorted({note.reading for note in self.used_by}))


@dataclass(frozen=True)
class Dependents:
    entries: tuple[tuple[str, str], ...]  # (entry id, author) of versions citing the entry
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
    author: str  # whose version is used
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

    def source_path(self, entry_id: str, author: str) -> Path:
        return self.folder(entry_id) / f"{author}.typ"

    def code_path(self, entry_id: str, author: str) -> Path:
        return self.folder(entry_id) / f"{author}.py"

    def section_path(self, entry_id: str, author: str, section: str) -> Path:
        return self.folder(entry_id) / f"{author}.{section}.typ"

    def read_sections(self, entry_id: str, entry_type: str, author: str) -> dict[str, str]:
        """Non-blank sections of a version, in display order. Empty for the types that do not
        carry sections: files left over from a change of type are ignored, not deleted."""
        found = {}
        for section in SECTIONS if entry_type in SECTION_TYPES else ():
            path = self.section_path(entry_id, author, section)
            if path.exists() and (text := path.read_text(encoding="utf-8")).strip():
                found[section] = text
        return found

    def page_paths(self, entry_id: str, author: str) -> list[Path]:
        pages = [p for p in self.folder(entry_id).glob(f"{author}-*.svg") if (m := PAGE_FILE.match(p.name)) and m["author"] == author]
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
        versions, cites, imports = [], set(), set()
        for author, info in sorted(raw.get("auteurs", {}).items()):
            source_path = self.source_path(entry_id, author)
            if not source_path.exists():
                continue
            texts = [source_path.read_text(encoding="utf-8"), *self.read_sections(entry_id, raw["type"], author).values()]
            cites |= {target for text in texts for kind, target in citations(text) if kind == "voir"}
            code_path = self.code_path(entry_id, author)
            code = code_path.read_text(encoding="utf-8") if code_path.exists() else None
            imports |= brick_imports(code or "")
            versions.append(Version(
                author=author,
                name=info["nom"],
                initials=info["initiales"],
                updated_at=info["updatedAt"],
                valid=info.get("valide", True),
                pages=tuple(self.page_paths(entry_id, author)),
                code=code,
            ))
        meta = EntryMeta(raw["type"], raw["titre"])
        used_by = tuple(sorted(usage.get(entry_id, []), key=lambda n: (n.reading, n.author)))
        questions = tuple((q["id"], q["reading"]) for q in raw.get("questions", []))
        return Entry(entry_id, meta, tuple(versions), tuple(sorted(cites - {entry_id})), used_by, tuple(sorted(imports - {entry_id})), questions)

    def get(self, entry_id: str) -> Entry:
        return self._entry(entry_id, self._read_raw(entry_id), self._usage())

    def list(self) -> list[Entry]:
        usage = self._usage()
        ids = [path.parent.name for path in self.entries_root.glob("*/entree.json")]
        entries = [self._entry(entry_id, self._read_raw(entry_id), usage) for entry_id in ids]
        return sorted(entries, key=lambda e: e.meta.titre.lower())

    def load_version(self, entry_id: str, author: str) -> VersionFiles:
        self._read_raw(entry_id)  # unknown entry -> 404

        def read(path: Path) -> str | None:
            return path.read_text(encoding="utf-8") if path.exists() else None

        return VersionFiles(
            source=read(self.source_path(entry_id, author)),
            code=read(self.code_path(entry_id, author)),
            hypotheses=read(self.section_path(entry_id, author, "hypotheses")),
            limites=read(self.section_path(entry_id, author, "limites")),
        )

    def dependents(self, entry_id: str) -> Dependents:
        entries = []
        for path in sorted(self.entries_root.glob("*/*.typ")):
            # <author>.typ, <author>.hypotheses.typ, <author>.limites.typ: an author's name has no dot.
            other, author = path.parent.name, path.name.split(".", 1)[0]
            if other != entry_id and (other, author) not in entries and ("voir", entry_id) in citations(path.read_text(encoding="utf-8")):
                entries.append((other, author))
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

    def brick_sources(self, author: str) -> list[BrickSource]:
        """Code of every brick for a run by ``author``: their own version, else the first other
        author's (alphabetical), so that a simulation works even without one's own bricks."""
        bricks = []
        for path in sorted(self.entries_root.glob("*/entree.json")):
            entry_id = path.parent.name
            raw = self._read_raw(entry_id)
            if raw["type"] != BRICK:
                continue
            authors = [a for a in sorted(raw.get("auteurs", {})) if self.code_path(entry_id, a).exists()]
            if not authors:
                continue
            chosen = author if author in authors else authors[0]
            code = self.code_path(entry_id, chosen).read_text(encoding="utf-8")
            bricks.append(BrickSource(entry_id, module_name(entry_id), chosen, code))
        return bricks

    def importers(self, entry_id: str) -> list[str]:
        """Entries whose code imports this brick."""
        found = set()
        for path in self.entries_root.glob("*/*.py"):
            if path.parent.name != entry_id and entry_id in brick_imports(path.read_text(encoding="utf-8")):
                found.add(path.parent.name)
        return sorted(found)

    def create(self, entry_id: str, meta: EntryMeta) -> tuple[Entry, RebuildReport]:
        self._check_type(entry_id, meta.type)
        with self._writes:
            if self.exists(entry_id):
                raise EntryExistsError(entry_id, self._read_raw(entry_id)["type"])
            self._write_raw(entry_id, {"type": meta.type, "titre": meta.titre, "auteurs": {}})
            self._regenerate()
        # Notes or entries may already have cited this identifier (and failed): retry them.
        return self.get(entry_id), self._rebuild(entry_id, entries=True, all_notes=True)

    def link_question(self, entry_id: str, question_id: str, reading: int, linked: bool) -> Entry:
        """Links an AnalystPrep question to an entry (or unlinks it); idempotent. Stored in
        entree.json, shared like the rest of the corpus. Nothing to recompile: renderings do not
        show the links; only the manifest (corpus page, quiz page) changes. The links do not attach
        the entry to the question's reading: readings come from the notes only."""
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

    def update_meta(self, entry_id: str, meta: EntryMeta) -> tuple[Entry, RebuildReport]:
        self._check_type(entry_id, meta.type)
        with self._writes:
            raw = self._read_raw(entry_id)
            raw.update(type=meta.type, titre=meta.titre)
            raw.pop("readings", None)  # stored by the first version of the corpus, now derived
            self._write_raw(entry_id, raw)
            self._regenerate()
            authors = list(raw.get("auteurs", {}))
        report = RebuildReport()
        for author in authors:  # their box shows the type and the title
            self._rerender_into(entry_id, author, report)
        # Citing entries and all notes show the title.
        return self.get(entry_id), self._rebuild(entry_id, entries=True, all_notes=True, report=report)

    def save_version(
        self,
        entry_id: str,
        author: str,
        name: str,
        initials: str,
        source: str,
        code: str | None,
        hypotheses: str | None = None,
        limites: str | None = None,
    ) -> tuple[Entry, RebuildReport]:
        """Writes a version. ``code``, ``hypotheses`` and ``limites`` left at None are not touched;
        a blank section removes its file (the block disappears)."""
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
            try:
                self.source_path(entry_id, author).write_text(source, encoding="utf-8")
                if code is not None:
                    self.code_path(entry_id, author).write_text(code, encoding="utf-8")
                for section, text in sections.items():
                    if text is None:
                        continue
                    path = self.section_path(entry_id, author, section)
                    if text.strip():
                        path.write_text(text, encoding="utf-8")
                    else:
                        path.unlink(missing_ok=True)
            except OSError as error:
                raise StorageError(str(self.folder(entry_id)), str(error)) from error
            raw.setdefault("auteurs", {})[author] = {"nom": name, "initiales": initials, "updatedAt": int(time.time() * 1000)}
            try:
                self._render(entry_id, raw, author, source)
                raw["auteurs"][author]["valide"] = True
            except TypstCompileError as error:
                raw["auteurs"][author]["valide"] = False  # left out of _corpus.typ until fixed
                error.saved = True
                failure = error
            self._write_raw(entry_id, raw)
            self._regenerate()
        # The content changed: notes inserting the entry must be recompiled (citing ones only show the title).
        # Also when the version failed: it left _corpus.typ, so those notes change too.
        report = self._rebuild(entry_id, entries=False, all_notes=False)
        if failure:
            failure.rebuild = report.to_dict()  # the 422 carries the report too
            raise failure
        return self.get(entry_id), report

    def delete(self, entry_id: str) -> RebuildReport:
        """Deletes an entry (every version) and its references: in the notes and the other entries,
        #voir becomes the title as plain text and #entree disappears (see strip_references); what
        was rewritten is recompiled, its failures reported, never raised. A brick still imported by
        some code is refused: removing the import would break that code."""
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
            label = f"notes/r{target.reading}/fiche-{target.author}"
            try:
                self.notes.save(target, new_source)
                report.rebuilt.append(label)
            except TypstCompileError as error:
                report.failed.append({"target": label, "message": error.message})
        rewritten = []
        with self._writes:
            for path in sorted(self.entries_root.glob("*/*.typ")):
                other, author = path.parent.name, path.name.split(".", 1)[0]
                if other == entry_id:
                    continue
                new_text, count = strip_references(path.read_text(encoding="utf-8"), entry_id, raw["titre"])
                if count:
                    try:
                        path.write_text(new_text, encoding="utf-8")
                    except OSError as error:
                        raise StorageError(str(path), str(error)) from error
                    if (other, author) not in rewritten:
                        rewritten.append((other, author))
        for other, author in rewritten:
            if self.source_path(other, author).exists():
                self._rerender_into(other, author, report)
        with self._writes:
            try:
                shutil.rmtree(self.folder(entry_id))
            except OSError as error:
                raise StorageError(str(self.folder(entry_id)), str(error)) from error
            self._regenerate()
        return report

    def preview(self, entry_type: str, titre: str, initials: str, source: str, hypotheses: str | None = None, limites: str | None = None) -> list[str]:
        """SVG of an unsaved version, rendered in its box. Nothing is written."""
        texts = {"hypotheses": hypotheses, "limites": limites}
        for text in (source, *texts.values()):
            if text is not None and FORBIDDEN.search(text):
                raise CorpusImportForbiddenError()
        sections = {section: text for section, text in texts.items() if text is not None and text.strip()}
        return self._box_pages(entry_type, titre, initials, source, sections)

    def regenerate(self) -> None:
        with self._writes:
            self._regenerate()

    # -------------------------------------------------------------- rendering

    @staticmethod
    def _wrapper(entry_type: str, titre: str, initials: str, sections: dict[str, str] | None = None) -> tuple[str, str]:
        """(prelude, suffix) putting a source inside its box. The sections go in the prelude as
        named arguments: ``bloc-entree`` draws them under the body."""
        arguments = "".join(f", {section}: [\n{text}\n]" for section, text in (sections or {}).items())
        prelude = (
            '#import "/_gabarit.typ": bloc-entree, page-entree\n#show: page-entree\n'
            f"#bloc-entree({typst_string(entry_type)}, {typst_string(titre)}, {typst_string(initials)}{arguments})[\n"
        )
        return prelude, "\n]\n"

    def _box_pages(self, entry_type: str, titre: str, initials: str, source: str, sections: dict[str, str]) -> list[str]:
        """SVG pages of a version in its box (non-blank sections only, and only for the types that
        carry them). A version with sections that does not compile gets ``error.part``: each text is
        then compiled alone in the box to find the guilty one, whose own line numbers are reported."""
        sections = sections if entry_type in SECTION_TYPES else {}
        failure = None
        try:
            # With sections, a line found by searching the source alone would mean nothing: skip it.
            return self.compiler.svg_pages(source, wrapper=self._wrapper(entry_type, titre, initials, sections), locate=not sections)
        except TypstCompileError as error:
            if not sections:
                raise
            failure = error
        alone = self._wrapper(entry_type, titre, initials)
        for part, text in (("source", source), *sections.items()):
            try:
                self.compiler.svg_pages(text, wrapper=alone)
            except TypstCompileError as error:
                error.part = part
                raise
        raise failure  # every text compiles alone: the failure comes from how they fit together

    def _render(self, entry_id: str, raw: dict, author: str, source: str) -> None:
        """Write the SVG pages of a version (lock held). Raises TypstCompileError."""
        info = raw["auteurs"][author]
        sections = self.read_sections(entry_id, raw["type"], author)
        pages = self._box_pages(raw["type"], raw["titre"], info["initiales"], source, sections)
        try:
            for old in self.page_paths(entry_id, author)[len(pages):]:
                old.unlink()
            for number, page in enumerate(pages, 1):
                (self.folder(entry_id) / f"{author}-{number}.svg").write_text(page, encoding="utf-8")
        except OSError as error:
            raise StorageError(str(self.folder(entry_id)), str(error)) from error

    def _rerender_into(self, entry_id: str, author: str, report: RebuildReport) -> None:
        """Re-render one saved version and record the outcome; its validity flag follows.

        Takes the lock for this version only: a batch of dependents is not one critical section,
        another write may interleave between two of them (harmless, each step is consistent)."""
        label = f"corpus/{entry_id}/{author}"
        with self._writes:
            raw = self._read_raw(entry_id)
            source = self.source_path(entry_id, author).read_text(encoding="utf-8")
            try:
                self._render(entry_id, raw, author, source)
                raw["auteurs"][author]["valide"] = True
                report.rebuilt.append(label)
            except TypstCompileError as error:
                raw["auteurs"][author]["valide"] = False
                report.failed.append({"target": label, "message": error.message})
            self._write_raw(entry_id, raw)
            self._regenerate()

    def _rebuild(self, entry_id: str, *, entries: bool, all_notes: bool, report: RebuildReport | None = None) -> RebuildReport:
        """Recompile what depends on an entry, without ever failing the caller."""
        report = report or RebuildReport()
        deps = self.dependents(entry_id)
        tasks = [("entry", e) for e in deps.entries] if entries else []
        tasks += [("note", n) for n in (deps.notes if all_notes else deps.inserting_notes)]
        for index, (kind, target) in enumerate(tasks):
            label = f"corpus/{target[0]}/{target[1]}" if kind == "entry" else f"notes/r{target.reading}/fiche-{target.author}"
            if len(report.rebuilt) + len(report.failed) >= MAX_SYNC_REBUILDS:
                report.skipped.append(label)
                continue
            if kind == "entry":
                self._rerender_into(target[0], target[1], report)
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
        versions = []
        for eid, raw in raws.items():
            valid = [
                self._version_literal(eid, raw["type"], author, info)
                for author, info in sorted(raw.get("auteurs", {}).items())
                if info.get("valide", True) and self.source_path(eid, author).exists()
            ]
            if valid:
                versions.append(f"{typst_string(eid)}: {typst_dict(valid, indent=2)},")
        try:
            write_atomic(self.root / "_corpus-titres.typ", TITLES_TEMPLATE.format(titles=typst_dict(titles)))
            write_atomic(self.root / "_corpus.typ", CORPUS_TEMPLATE.format(versions=typst_dict(versions)))
            write_atomic(self.entries_root / "index.js", self._manifest(raws))
        except OSError as error:
            raise StorageError(str(self.root), str(error)) from error

    def _version_literal(self, entry_id: str, entry_type: str, author: str, info: dict) -> str:
        """One version in _corpus.typ: its initials and, behind closures, its texts (``none`` for a section it has not)."""
        sections = self.read_sections(entry_id, entry_type, author)

        def include(file_name: str) -> str:
            return f"() => include {typst_string(f'corpus/{entry_id}/{file_name}')}"

        parts = [f"initiales: {typst_string(info['initiales'])}", f"corps: {include(f'{author}.typ')}"]
        parts += [f"{section}: {include(f'{author}.{section}.typ') if section in sections else 'none'}" for section in SECTIONS]
        return f"{typst_string(author)}: ({', '.join(parts)}),"

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
        "cites": list(entry.cites),
        "imports": list(entry.imports),
        "usedBy": [{"reading": n.reading, "author": n.author} for n in entry.used_by],
        "questions": [{"id": question, "reading": reading} for question, reading in entry.questions],
        "versions": [
            {
                "author": v.author,
                "name": v.name,
                "initials": v.initials,
                "updatedAt": v.updated_at,
                "valid": v.valid,
                "pages": [url(p) for p in v.pages],
                "code": v.code,
            }
            for v in entry.versions
        ],
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
// Each version sits behind a closure: its file is evaluated only when a note inserts it.
#import "/_gabarit.typ": bloc-entree
#import "/_corpus-titres.typ": corpus-titres, voir

#let corpus-versions = {versions}

// One version in its box; a section that the version does not have is none.
#let boite(meta, version) = bloc-entree(
  meta.type, meta.titre, version.initiales, (version.corps)(),
  hypotheses: if version.hypotheses != none {{ (version.hypotheses)() }},
  limites: if version.limites != none {{ (version.limites)() }},
)

#let entree(id, auteur: none) = {{
  if id not in corpus-titres {{ panic("Entrée inconnue du corpus : " + id) }}
  let meta = corpus-titres.at(id)
  let versions = corpus-versions.at(id, default: (:))
  if auteur != none {{
    if auteur not in versions {{ panic("Pas de version valide de « " + auteur + " » pour l'entrée " + id) }}
    boite(meta, versions.at(auteur))
  }} else {{
    if versions.len() == 0 {{ panic("L'entrée " + id + " n'a encore aucune version valide") }}
    for (author, version) in versions {{
      boite(meta, version)
    }}
  }}
}}
"""
