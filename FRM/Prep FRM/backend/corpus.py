"""Shared corpus: formulas, definitions, properties, theorems, products, simulations and code bricks
written by us.

An entry has a readable, fixed identifier (``bayes``) and belongs to everyone. It is one Markdown
file, ``corpus/<id>.md``, shared with Obsidian (``notes/`` is the vault, so ``[[bayes]]`` resolves
there too). Its YAML header holds what the site manages:

    type, titre        always
    readings           readings attached by hand (choice of Baptiste, 2026-11-19)
    questions          linked AnalystPrep questions: [{id, reading}]
    variables          financial products: [{nom, note}], filled in the code (``from produits import produit``)

Every other key (tags, aliases… added in Obsidian) is kept as is: the site changes only its own
keys (backend/frontmatter.py). The body is the text; it ends with ``## Hypothèses`` and
``## Limites`` for a formula, ``## Code`` (one Python block) for a simulation or a brick.

Entries cite each other with ``[[id]]``; notes cite with ``[[id]]`` or insert a whole entry with
``![[id]]``. git keeps the texts and says who changed them (backend/history.py).

A brick is reusable Python code that simulations import: brick ``donnees-aleatoires`` is module
``briques.donnees_aleatoires`` (``from briques.donnees_aleatoires import generate_random_data``).

An entry's readings have three origins, kept apart: the readings attached by hand, those of the
notes citing or inserting it, and those of the questions linked to it. Only the first is stored.
Citations by other entries do not count, or everything would end up attached to everything.

Back-links come from a regex over the sources: best effort, for display, never a safety check.
"""
from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from backend.errors import BrickInUseError, EntryExistsError, InvalidRequestError, StorageError, UnknownEntryError
from backend.files import remove, write_atomic
from backend.frontmatter import Document, Sections, join_sections, parse_sections
from backend.history import HistoryService, Snapshot
from backend.notes import NotesService, NoteTarget

ENTRY_TYPES = ("formule", "definition", "propriete", "theoreme", "produit", "simulation", "brique")
BRICK = "brique"
CODE_TYPES = ("simulation", BRICK)  # entries carrying Python code
SECTIONS = ("hypotheses", "limites")  # texts written under a formula, in this order
SECTION_TYPES = ("formule",)  # entries carrying them
VARIABLE_TYPES = ("produit",)  # entries declaring variables
ENTRY_FILE = re.compile(r"^(?P<id>[a-z0-9][a-z0-9-]*)\.md$")
BRICK_IMPORT = re.compile(r"^[ \t]*(?:from|import)[ \t]+briques\.([A-Za-z_]\w*)", re.MULTILINE)
# [[id]], [[id|shown text]], [[id#heading]]; with "!" in front, the entry is inserted. An image
# (![[name.png]]) never matches: identifiers have no dot.
CITATION = re.compile(r"(?P<embed>!?)\[\[(?P<id>[a-z0-9][a-z0-9-]*)(?:#[^\]|]*)?(?:\|(?P<alias>[^\]]*))?\]\]")


def recognised_sections(entry_type: str) -> tuple[str, ...]:
    return (SECTIONS if entry_type in SECTION_TYPES else ()) + (("code",) if entry_type in CODE_TYPES else ())


@dataclass(frozen=True)
class EntryMeta:
    type: str
    titre: str


@dataclass(frozen=True)
class EntryTexts:
    """What is written for an entry (None: absent)."""

    source: str | None
    code: str | None
    hypotheses: str | None
    limites: str | None
    variables: list[dict] | None = None  # financial products: [{nom, note}]


@dataclass(frozen=True)
class Entry:
    id: str
    meta: EntryMeta
    source: str  # the text, without the sections
    hypotheses: str | None
    limites: str | None
    code: str | None  # simulations and bricks only
    journal: tuple[dict, ...]  # commits touching it (backend/history.py), oldest first
    modified: bool  # changed since the last commit
    updated_at: int
    cites: tuple[str, ...]  # entries cited or inserted by its texts
    used_by: tuple[NoteTarget, ...]  # notes citing or inserting it
    imports: tuple[str, ...] = ()  # bricks imported by its code
    questions: tuple[tuple[str, int], ...] = ()  # linked AnalystPrep questions: (question id, reading)
    variables: tuple[dict, ...] = ()  # financial products: [{nom, note}]
    direct_readings: tuple[int, ...] = ()  # readings attached by hand

    @property
    def has_text(self) -> bool:
        return bool(self.source.strip())

    @property
    def note_readings(self) -> tuple[int, ...]:
        return tuple(sorted({note.reading for note in self.used_by}))

    @property
    def question_readings(self) -> tuple[int, ...]:
        return tuple(sorted({reading for _, reading in self.questions}))

    @property
    def readings(self) -> tuple[int, ...]:
        """Readings attached by hand, plus those of the notes using it and of its questions."""
        return tuple(sorted(set(self.direct_readings) | set(self.note_readings) | set(self.question_readings)))


@dataclass(frozen=True)
class Dependents:
    entries: tuple[str, ...]  # entries whose texts cite the entry
    notes: tuple[NoteTarget, ...]  # notes citing or inserting the entry


@dataclass(frozen=True)
class BrickSource:
    entry_id: str
    module: str
    code: str


def module_name(entry_id: str) -> str:
    """Python module of a brick: ``donnees-aleatoires`` -> ``donnees_aleatoires``."""
    return entry_id.replace("-", "_")


def brick_imports(code: str) -> set[str]:
    """Brick ids imported by some code (``from briques.x import …`` or ``import briques.x``)."""
    return {module.replace("_", "-") for module in BRICK_IMPORT.findall(code)}


def citations(source: str) -> set[tuple[str, str]]:
    """{(kind, id)} found in a source, kind being "voir" ([[id]]) or "entree" (![[id]])."""
    return {("entree" if m["embed"] else "voir", m["id"]) for m in CITATION.finditer(source)}


MARKDOWN_SPECIAL = re.compile(r"([\\*_\[\]`$<>#|])")


def strip_references(source: str, entry_id: str, titre: str) -> tuple[str, int]:
    """Removes an entry's references from a Markdown text, for its deletion: ``[[id]]`` becomes the
    title as plain text (or the shown text of ``[[id|…]]``), ``![[id]]`` disappears, with its line
    when nothing else is on it. Returns (new text, number of references removed)."""
    count = 0

    def replace(match: re.Match) -> str:
        nonlocal count
        if match["id"] != entry_id:
            return match[0]
        count += 1
        return "" if match["embed"] else MARKDOWN_SPECIAL.sub(r"\\\1", match["alias"] or titre)

    lines = []
    for line in source.split("\n"):
        new = CITATION.sub(replace, line)
        if new != line and not new.strip() and any(m["embed"] and m["id"] == entry_id for m in CITATION.finditer(line)):
            continue  # a line holding only the inserted entry goes with it
        lines.append(new)
    return "\n".join(lines), count


class CorpusService:
    def __init__(self, root: Path, notes: NotesService, history: HistoryService):
        self.root = root  # notes/, the vault
        self.entries_root = root / "corpus"
        self.notes = notes
        self.history = history
        # Own lock for entry files and the manifest; notes keep theirs. Readers are safe anyway:
        # files are written atomically.
        self._writes = threading.Lock()

    # -------------------------------------------------------------- files

    def path(self, entry_id: str) -> Path:
        return self.entries_root / f"{entry_id}.md"

    def exists(self, entry_id: str) -> bool:
        return self.path(entry_id).exists()

    def ids(self) -> list[str]:
        if not self.entries_root.exists():
            return []
        return sorted(m["id"] for p in self.entries_root.glob("*.md") if (m := ENTRY_FILE.match(p.name)))

    def _load(self, entry_id: str) -> Document:
        path = self.path(entry_id)
        if not path.exists():
            raise UnknownEntryError(entry_id)
        try:
            document = Document.parse(path.read_text(encoding="utf-8"))
        except OSError as error:
            raise StorageError(str(path), str(error)) from error
        except Exception as error:  # noqa: BLE001 - a broken YAML header written by hand
            raise StorageError(str(path), f"en-tête YAML illisible : {error}") from error
        return document

    def _save(self, entry_id: str, document: Document) -> None:
        try:
            write_atomic(self.path(entry_id), document.dump())
        except OSError as error:
            raise StorageError(str(self.path(entry_id)), str(error)) from error

    @staticmethod
    def _meta(entry_id: str, document: Document) -> EntryMeta:
        entry_type = document.get("type")
        titre = document.get("titre")
        return EntryMeta(
            entry_type if entry_type in ENTRY_TYPES else "definition",
            str(titre) if titre not in (None, "") else entry_id,
        )

    @staticmethod
    def _direct_readings(document: Document) -> tuple[int, ...]:
        """Readings attached by hand, sorted; anything but an integer is ignored."""
        found = document.get("readings") or []
        return tuple(sorted({r for r in found if type(r) is int})) if isinstance(found, list) else ()

    @staticmethod
    def _questions(document: Document) -> list[dict]:
        found = document.get("questions") or []
        if not isinstance(found, list):
            return []
        return [
            {"id": str(q["id"]), "reading": q["reading"]}
            for q in found
            if isinstance(q, dict) and "id" in q and type(q.get("reading")) is int
        ]

    @staticmethod
    def _variables(document: Document, entry_type: str) -> list[dict]:
        found = document.get("variables") or []
        if entry_type not in VARIABLE_TYPES or not isinstance(found, list):
            return []
        return [{"nom": str(v["nom"]), "note": str(v.get("note") or "")} for v in found if isinstance(v, dict) and "nom" in v]

    def _sections(self, document: Document, entry_type: str) -> Sections:
        return parse_sections(document.body, recognised_sections(entry_type))

    # -------------------------------------------------------------- reading

    def _usage(self) -> dict[str, list[NoteTarget]]:
        """{entry id: notes citing or inserting it}, from one pass over the notes."""
        usage: dict[str, list[NoteTarget]] = {}
        for target, source in self.notes.sources():
            for entry_id in sorted({eid for _, eid in citations(source)}):
                usage.setdefault(entry_id, []).append(target)
        return usage

    def _entry(self, entry_id: str, document: Document, usage: dict[str, list[NoteTarget]], snapshot: Snapshot) -> Entry:
        meta = self._meta(entry_id, document)
        sections = self._sections(document, meta.type)
        cites = {target for _, target in citations(document.body)}
        mtime = int(self.path(entry_id).stat().st_mtime * 1000)
        modified = snapshot.is_modified("entry", entry_id)
        return Entry(
            id=entry_id,
            meta=meta,
            source=sections.text,
            hypotheses=sections.hypotheses,
            limites=sections.limites,
            code=sections.code,
            journal=tuple(snapshot.sessions("entry", entry_id)),
            modified=modified,
            updated_at=max(snapshot.updated_at("entry", entry_id), mtime if modified else 0) or mtime,
            cites=tuple(sorted(cites - {entry_id})),
            used_by=tuple(sorted(usage.get(entry_id, []), key=lambda n: n.reading)),
            imports=tuple(sorted(brick_imports(sections.code or "") - {entry_id})),
            questions=tuple((q["id"], q["reading"]) for q in self._questions(document)),
            variables=tuple(self._variables(document, meta.type)),
            direct_readings=self._direct_readings(document),
        )

    def get(self, entry_id: str) -> Entry:
        return self._entry(entry_id, self._load(entry_id), self._usage(), self.history.snapshot())

    def list(self) -> list[Entry]:
        usage, snapshot = self._usage(), self.history.snapshot()
        entries = []
        for entry_id in self.ids():
            try:
                entries.append(self._entry(entry_id, self._load(entry_id), usage, snapshot))
            except StorageError:
                continue  # one broken file must not hide the corpus
        return sorted(entries, key=lambda e: e.meta.titre.lower())

    def load_texts(self, entry_id: str) -> EntryTexts:
        document = self._load(entry_id)  # unknown entry -> 404
        meta = self._meta(entry_id, document)
        sections = self._sections(document, meta.type)
        return EntryTexts(
            source=sections.text,
            code=sections.code,
            hypotheses=sections.hypotheses,
            limites=sections.limites,
            variables=self._variables(document, meta.type) if meta.type in VARIABLE_TYPES else None,
        )

    def products(self) -> dict[str, dict]:
        """{product id: {variable name: note}} of every financial product, for the code."""
        found = {}
        for entry_id in self.ids():
            document = self._load(entry_id)
            if self._meta(entry_id, document).type in VARIABLE_TYPES:
                found[entry_id] = {v["nom"]: v["note"] for v in self._variables(document, VARIABLE_TYPES[0])}
        return found

    def brick_sources(self) -> list[BrickSource]:
        """Code of every brick, for a run: each brick has one shared code."""
        bricks = []
        for entry_id in self.ids():
            document = self._load(entry_id)
            if self._meta(entry_id, document).type != BRICK:
                continue
            code = self._sections(document, BRICK).code
            if code is not None:
                bricks.append(BrickSource(entry_id, module_name(entry_id), code))
        return bricks

    def importers(self, entry_id: str) -> list[str]:
        """Entries whose code imports this brick."""
        found = []
        for other in self.ids():
            if other == entry_id:
                continue
            document = self._load(other)
            code = self._sections(document, self._meta(other, document).type).code or ""
            if entry_id in brick_imports(code):
                found.append(other)
        return found

    def dependents(self, entry_id: str) -> Dependents:
        entries = [
            other
            for other in self.ids()
            if other != entry_id and entry_id in {eid for _, eid in citations(self.path(other).read_text(encoding="utf-8"))}
        ]
        notes = [target for target, source in self.notes.sources() if entry_id in {eid for _, eid in citations(source)}]
        return Dependents(tuple(entries), tuple(notes))

    # -------------------------------------------------------------- writing

    @staticmethod
    def _check_type(entry_id: str, entry_type: str) -> None:
        if entry_type == BRICK and not entry_id[0].isalpha():
            raise InvalidRequestError("id", "une brique est un module Python : son identifiant commence par une lettre")

    def create(self, entry_id: str, meta: EntryMeta) -> Entry:
        self._check_type(entry_id, meta.type)
        with self._writes:
            if self.exists(entry_id):
                raise EntryExistsError(entry_id, self._meta(entry_id, self._load(entry_id)).type)
            document = Document.new()
            document.set("type", meta.type)
            document.set("titre", meta.titre)
            self._save(entry_id, document)
            self._regenerate()
        return self.get(entry_id)

    def link_question(self, entry_id: str, question_id: str, reading: int, linked: bool) -> Entry:
        """Links an AnalystPrep question to an entry (or unlinks it); idempotent. The link attaches
        the entry to the question's reading, like a note citing it does."""
        with self._writes:
            document = self._load(entry_id)
            questions = [q for q in self._questions(document) if q["id"] != question_id]
            if linked:
                questions.append({"id": question_id, "reading": reading})
            questions.sort(key=lambda q: (q["reading"], int(q["id"]) if q["id"].isdigit() else 0))
            if questions:
                document.set("questions", questions)
            else:
                document.delete("questions")
            self._save(entry_id, document)
            self._regenerate()
        return self.get(entry_id)

    def change_readings(self, entry_ids: list[str], add: list[int], remove: list[int]) -> list[Entry]:
        """Attaches readings to entries by hand (``add``) and detaches others (``remove``), for one
        entry or many, idempotent. Every entry is read before anything is written, so an unknown
        one changes nothing. Only the readings attached by hand are touched."""
        with self._writes:
            documents = {entry_id: self._load(entry_id) for entry_id in dict.fromkeys(entry_ids)}  # unknown -> 404
            changed = False
            for entry_id, document in documents.items():
                before = self._direct_readings(document)
                after = sorted((set(before) | set(add)) - set(remove))
                if tuple(after) == before:
                    continue
                if after:
                    document.set("readings", after)
                else:
                    document.delete("readings")
                self._save(entry_id, document)
                changed = True
            if changed:
                self._regenerate()
        return [self.get(entry_id) for entry_id in documents]

    def update_meta(self, entry_id: str, meta: EntryMeta) -> Entry:
        self._check_type(entry_id, meta.type)
        with self._writes:
            document = self._load(entry_id)
            document.set("type", meta.type)
            document.set("titre", meta.titre)  # the readings attached by hand stay
            self._save(entry_id, document)
            self._regenerate()
        return self.get(entry_id)

    def save_text(
        self,
        entry_id: str,
        source: str,
        code: str | None,
        hypotheses: str | None = None,
        limites: str | None = None,
        variables: list[dict] | None = None,
    ) -> Entry:
        """Writes the entry's text. ``code``, ``hypotheses``, ``limites`` and ``variables`` left at
        None are not touched; a blank section is removed, and so is an empty list of variables."""
        with self._writes:
            document = self._load(entry_id)
            entry_type = self._meta(entry_id, document).type
            if code is not None and entry_type not in CODE_TYPES:
                raise InvalidRequestError("code", "le code Python est réservé aux simulations et aux briques")
            for section, text in (("hypotheses", hypotheses), ("limites", limites)):
                if text is not None and text.strip() and entry_type not in SECTION_TYPES:
                    raise InvalidRequestError(section, "les hypothèses et les limites sont réservées aux formules")
            if variables and entry_type not in VARIABLE_TYPES:
                raise InvalidRequestError("variables", "les variables sont réservées aux produits financiers")
            current = self._sections(document, entry_type)
            document.body = join_sections(
                Sections(
                    text=source,
                    hypotheses=current.hypotheses if hypotheses is None else hypotheses,
                    limites=current.limites if limites is None else limites,
                    code=current.code if code is None else code,
                )
            )
            if variables is not None:
                if variables:
                    document.set("variables", variables)
                else:
                    document.delete("variables")
            self._save(entry_id, document)
            self._regenerate()
        return self.get(entry_id)

    def delete(self, entry_id: str) -> list[str]:
        """Deletes an entry and its references: in the notes and the other entries, [[id]] becomes
        the title as plain text and ![[id]] disappears (see strip_references). A brick still
        imported by some code is refused: removing the import would break that code. Returns the
        texts rewritten."""
        document = self._load(entry_id)  # unknown entry -> 404
        meta = self._meta(entry_id, document)
        if meta.type == BRICK and (users := self.importers(entry_id)):
            raise BrickInUseError(entry_id, users)
        rewritten = []
        # References first, while the entry still exists: an interruption leaves an unused entry,
        # never a text citing a missing one.
        for target, source in list(self.notes.sources()):
            new_source, count = strip_references(source, entry_id, meta.titre)
            if count:
                self.notes.save(target, new_source)
                rewritten.append(target.label)
        with self._writes:
            for other in self.ids():
                if other == entry_id:
                    continue
                other_document = self._load(other)
                new_body, count = strip_references(other_document.body, entry_id, meta.titre)
                if count:
                    other_document.body = new_body
                    self._save(other, other_document)
                    rewritten.append(f"corpus/{other}")
            try:
                remove(self.path(entry_id))
            except OSError as error:
                raise StorageError(str(self.path(entry_id)), str(error)) from error
            self._regenerate()
        return rewritten

    def regenerate(self) -> None:
        with self._writes:
            self._regenerate()

    # -------------------------------------------------------------- manifest

    def _regenerate(self) -> None:
        """Write corpus/index.js (lock held)."""
        try:
            write_atomic(self.entries_root / "index.js", self._manifest())
        except OSError as error:
            raise StorageError(str(self.entries_root), str(error)) from error

    def _manifest(self) -> str:
        """corpus/index.js: everything the site shows, readable from file:// pages."""
        entries = {entry.id: entry for entry in self.list()}
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
            eid: entry_to_dict(entry) | {"citedBy": sorted(cited_by[eid]), "importedBy": sorted(imported_by[eid])}
            for eid, entry in entries.items()
        }
        return (
            "// GENERATED by the Prep FRM server: the corpus, for pages opened without the server. Do not edit by hand.\n"
            f"FRM.registerCorpus({json.dumps(payload, ensure_ascii=False, sort_keys=True)});\n"
        )


def entry_to_dict(entry: Entry) -> dict:
    """Plain representation shared by the API and the manifest."""
    return {
        "id": entry.id,
        "type": entry.meta.type,
        "titre": entry.meta.titre,
        "readings": list(entry.readings),
        "directReadings": list(entry.direct_readings),
        "noteReadings": list(entry.note_readings),
        "questionReadings": list(entry.question_readings),
        "cites": list(entry.cites),
        "imports": list(entry.imports),
        "usedBy": [{"reading": n.reading} for n in entry.used_by],
        "questions": [{"id": question, "reading": reading} for question, reading in entry.questions],
        "hasText": entry.has_text,
        "source": entry.source,
        "hypotheses": entry.hypotheses,
        "limites": entry.limites,
        "code": entry.code,
        "updatedAt": entry.updated_at,
        "modified": entry.modified,
        "journal": list(entry.journal),
        "variables": list(entry.variables),
    }
