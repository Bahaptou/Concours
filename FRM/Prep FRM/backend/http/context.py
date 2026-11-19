"""Contexts: what a route computed, handed over to its presenter."""
from __future__ import annotations

from dataclasses import dataclass

from backend.notes import NoteTarget


@dataclass(frozen=True)
class NoteContext:
    target: NoteTarget
    exists: bool
    note: dict  # NotesService.to_dict: source, updatedAt, modified, journal (git history)


@dataclass(frozen=True)
class SavedNoteContext:
    target: NoteTarget
    saved_at: int
    note: dict


@dataclass(frozen=True)
class CorpusContext:
    entries: list  # list[backend.corpus.Entry]


@dataclass(frozen=True)
class RunContext:
    result: object  # backend.simulations.RunResult


@dataclass(frozen=True)
class EntryContext:
    entry: object  # backend.corpus.Entry
    dependents: object  # backend.corpus.Dependents
    imported_by: tuple[str, ...] = ()  # entries whose code imports this brick


@dataclass(frozen=True)
class TextContext:
    entry_id: str
    entry_type: str
    source: str | None
    code: str | None
    hypotheses: str | None
    limites: str | None
    variables: list | None = None  # financial products only


@dataclass(frozen=True)
class ImagesContext:
    images: list  # list[backend.images.Image]
    urls: dict  # image name -> URL of the file


@dataclass(frozen=True)
class ImageContext:
    image: object  # backend.images.Image
    url: str
