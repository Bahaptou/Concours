"""Notes service: reads and writes ``<root>/r<reading>/fiche-<author>.typ`` and their renderings.

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

from backend.compiler import TypstCompiler
from backend.errors import StorageError, TypstCompileError
from backend.files import write_atomic

PAGE_FILE = re.compile(r"^fiche-(?P<author>[a-z0-9-]+)-(?P<page>\d+)\.svg$")


@dataclass(frozen=True)
class NoteTarget:
    """A note is identified by its reading (1 to 62) and its author slug."""

    reading: int
    author: str


@dataclass(frozen=True)
class SavedNote:
    target: NoteTarget
    pages: int
    saved_at: int


class NotesService:
    def __init__(self, root: Path, compiler: TypstCompiler):
        self.root = root
        self.compiler = compiler
        # ThreadingHTTPServer runs requests in parallel: one lock keeps a save's writes
        # (source, pages, PDF, manifest) from interleaving with another's.
        self._writes = threading.Lock()
        # Extension point, wired by server.py: called after every save, even a failed one (the
        # text may be written). Notes do not know who listens (the corpus, whose readings come
        # from the notes' citations).
        self.on_saved: Callable[[], None] | None = None

    # -------------------------------------------------------------- paths

    def folder(self, target: NoteTarget) -> Path:
        return self.root / f"r{target.reading}"

    def source_path(self, target: NoteTarget) -> Path:
        return self.folder(target) / f"fiche-{target.author}.typ"

    def pdf_path(self, target: NoteTarget) -> Path:
        return self.folder(target) / f"fiche-{target.author}.pdf"

    def page_paths(self, target: NoteTarget) -> list[Path]:
        pages = [p for p in self.folder(target).glob(f"fiche-{target.author}-*.svg") if self._is_page_of(p, target.author)]
        return sorted(pages, key=lambda p: int(PAGE_FILE.match(p.name)["page"]))

    @staticmethod
    def _is_page_of(path: Path, author: str) -> bool:
        match = PAGE_FILE.match(path.name)
        return bool(match) and match["author"] == author

    # -------------------------------------------------------------- operations

    def load(self, target: NoteTarget) -> str | None:
        path = self.source_path(target)
        try:
            return path.read_text(encoding="utf-8") if path.exists() else None
        except OSError as error:
            raise StorageError(str(path), str(error)) from error

    def save(self, target: NoteTarget, source: str) -> SavedNote:
        try:
            with self._writes:
                return self._save(target, source)
        finally:
            # Outside the lock: the listener takes its own, locks are never nested.
            if self.on_saved:
                self.on_saved()

    def _save(self, target: NoteTarget, source: str) -> SavedNote:
        try:
            self.folder(target).mkdir(parents=True, exist_ok=True)
            self.source_path(target).write_text(source, encoding="utf-8")
        except OSError as error:
            raise StorageError(str(self.source_path(target)), str(error)) from error
        try:
            pages = self.compiler.svg_pages(source)
            pdf = self.compiler.pdf(source)
        except TypstCompileError as error:
            error.saved = True  # text kept on disk; the previous rendering stays for the reading page
            raise
        self._write_renderings(target, pages, pdf)
        self.write_manifest()
        return SavedNote(target, len(pages), int(time.time() * 1000))

    def rebuild(self, target: NoteTarget) -> None:
        """Recompile an existing note (an entry it uses changed). Raises TypstCompileError."""
        with self._writes:
            source = self.load(target)
            if source is None:
                return
            self._write_renderings(target, self.compiler.svg_pages(source), self.compiler.pdf(source))
            self.write_manifest()

    def sources(self):
        """(target, source) of every note: lets the corpus find the notes that use an entry."""
        for path in sorted(self.root.glob("r*/fiche-*.typ")):
            reading = path.parent.name[1:]
            if reading.isdigit():
                yield NoteTarget(int(reading), path.stem.removeprefix("fiche-")), path.read_text(encoding="utf-8")

    def _write_renderings(self, target: NoteTarget, pages: list[str], pdf: bytes) -> None:
        try:
            for old in self.page_paths(target)[len(pages):]:
                old.unlink()
            for number, page in enumerate(pages, 1):
                (self.folder(target) / f"fiche-{target.author}-{number}.svg").write_text(page, encoding="utf-8")
            self.pdf_path(target).write_bytes(pdf)
        except OSError as error:
            raise StorageError(str(self.folder(target)), str(error)) from error

    def write_manifest(self) -> None:
        """``index.js``: compiled notes by reading then author, readable from file:// pages."""
        notes: dict[str, dict[str, dict]] = {}
        for source in sorted(self.root.glob("r*/fiche-*.typ")):
            reading = source.parent.name[1:]
            if not reading.isdigit():
                continue
            target = NoteTarget(int(reading), source.stem.removeprefix("fiche-"))
            pages = len(self.page_paths(target))
            if pages:
                notes.setdefault(reading, {})[target.author] = {"pages": pages, "updatedAt": int(source.stat().st_mtime * 1000)}
        manifest = self.root / "index.js"
        try:
            write_atomic(
                manifest,
                "// GENERATED by the Prep FRM server: compiled notes, by reading then author. Do not edit by hand.\n"
                f"FRM.registerNotes({json.dumps(notes, ensure_ascii=False, sort_keys=True)});\n",
            )
        except OSError as error:
            raise StorageError(str(manifest), str(error)) from error
