"""Notes service: one shared note per reading, ``<root>/r<reading>/fiche.typ``, and its renderings.

A note belongs to everyone: whoever has the editor open writes into it. Its ``journal.jsonl``
(backend/journal.py) keeps who created it and who changed it when; git keeps the texts.

Saving always writes the source first (no work is ever lost), then the SVG pages and the PDF
when it compiles, then ``<root>/index.js``, the manifest that lets file:// pages show the notes.
"""
from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from backend import journal
from backend.compiler import TypstCompiler
from backend.errors import StorageError, TypstCompileError
from backend.files import remove, write_atomic
from backend.journal import Contributor

SOURCE = "fiche.typ"
PDF = "fiche.pdf"
PAGE_FILE = re.compile(r"^fiche-(?P<page>\d+)\.svg$")


@dataclass(frozen=True)
class NoteTarget:
    """A note is identified by its reading (1 to 62)."""

    reading: int

    @property
    def label(self) -> str:
        return f"notes/r{self.reading}/fiche"


@dataclass(frozen=True)
class SavedNote:
    target: NoteTarget
    pages: int
    saved_at: int


def now_ms() -> int:
    return int(time.time() * 1000)


class NotesService:
    def __init__(self, root: Path, compiler: TypstCompiler):
        self.root = root
        self.compiler = compiler
        # ThreadingHTTPServer runs requests in parallel: one lock keeps a save's writes
        # (source, journal, pages, PDF, manifest) from interleaving with another's.
        self._writes = threading.Lock()
        # Extension point, wired by server.py: called after every save, even a failed one (the
        # text may be written). Notes do not know who listens (the corpus, whose readings come
        # from the notes' citations).
        self.on_saved: Callable[[], None] | None = None

    # -------------------------------------------------------------- paths

    def folder(self, target: NoteTarget) -> Path:
        return self.root / f"r{target.reading}"

    def source_path(self, target: NoteTarget) -> Path:
        return self.folder(target) / SOURCE

    def pdf_path(self, target: NoteTarget) -> Path:
        return self.folder(target) / PDF

    def page_paths(self, target: NoteTarget) -> list[Path]:
        pages = [p for p in self.folder(target).glob("fiche-*.svg") if PAGE_FILE.match(p.name)]
        return sorted(pages, key=lambda p: int(PAGE_FILE.match(p.name)["page"]))

    # -------------------------------------------------------------- operations

    def load(self, target: NoteTarget) -> str | None:
        path = self.source_path(target)
        try:
            return path.read_text(encoding="utf-8") if path.exists() else None
        except OSError as error:
            raise StorageError(str(path), str(error)) from error

    def journal(self, target: NoteTarget) -> list[journal.Session]:
        return journal.read(self.folder(target))

    def save(self, target: NoteTarget, source: str, who: Contributor) -> SavedNote:
        try:
            with self._writes:
                return self._save(target, source, who)
        finally:
            # Outside the lock: the listener takes its own, locks are never nested.
            if self.on_saved:
                self.on_saved()

    def _save(self, target: NoteTarget, source: str, who: Contributor) -> SavedNote:
        saved_at = now_ms()
        try:
            self.folder(target).mkdir(parents=True, exist_ok=True)
            created = not self.source_path(target).exists()
            write_atomic(self.source_path(target), source)
        except OSError as error:
            raise StorageError(str(self.source_path(target)), str(error)) from error
        journal.record(self.folder(target), who, saved_at, creation=created)
        try:
            pages = self.compiler.svg_pages(source)
            pdf = self.compiler.pdf(source)
        except TypstCompileError as error:
            error.saved = True  # text kept on disk; the previous rendering stays for the reading page
            self.write_manifest()  # the journal changed
            raise
        self._write_renderings(target, pages, pdf)
        self.write_manifest()
        return SavedNote(target, len(pages), saved_at)

    def rebuild(self, target: NoteTarget) -> None:
        """Recompile an existing note (an entry it uses changed): not a change of the note, so the
        journal is left alone. Raises TypstCompileError."""
        with self._writes:
            source = self.load(target)
            if source is None:
                return
            self._write_renderings(target, self.compiler.svg_pages(source), self.compiler.pdf(source))
            self.write_manifest()

    def sources(self):
        """(target, source) of every note: lets the corpus find the notes that use an entry."""
        for path in sorted(self.root.glob(f"r*/{SOURCE}")):
            reading = path.parent.name[1:]
            if reading.isdigit():
                yield NoteTarget(int(reading)), path.read_text(encoding="utf-8")

    def _write_renderings(self, target: NoteTarget, pages: list[str], pdf: bytes) -> None:
        try:
            for old in self.page_paths(target)[len(pages):]:
                remove(old)
            for number, page in enumerate(pages, 1):
                write_atomic(self.folder(target) / f"fiche-{number}.svg", page)
            write_atomic(self.pdf_path(target), pdf)
        except OSError as error:
            raise StorageError(str(self.folder(target)), str(error)) from error

    def write_manifest(self) -> None:
        """``index.js``: the notes by reading (pages, last change, journal), readable from file:// pages."""
        notes: dict[str, dict] = {}
        for source in sorted(self.root.glob(f"r*/{SOURCE}")):
            reading = source.parent.name[1:]
            if not reading.isdigit():
                continue
            target = NoteTarget(int(reading))
            sessions = self.journal(target)
            notes[reading] = {
                "pages": len(self.page_paths(target)),
                "pdf": self.pdf_path(target).exists(),
                "updatedAt": max([s.end for s in sessions], default=int(source.stat().st_mtime * 1000)),
                "journal": journal.as_dicts(sessions),
            }
        manifest = self.root / "index.js"
        try:
            write_atomic(
                manifest,
                "// GENERATED by the Prep FRM server: the shared notes, by reading. Do not edit by hand.\n"
                f"FRM.registerNotes({json.dumps(notes, ensure_ascii=False, sort_keys=True)});\n",
            )
        except OSError as error:
            raise StorageError(str(manifest), str(error)) from error
