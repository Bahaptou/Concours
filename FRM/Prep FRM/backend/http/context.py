"""Contexts: what a route computed, handed over to its presenter."""
from __future__ import annotations

from dataclasses import dataclass

from backend.notes import NoteTarget


@dataclass(frozen=True)
class NoteContext:
    target: NoteTarget
    source: str | None
    pages: list[str]  # URLs of the compiled SVG pages, empty if never compiled
    pdf: str | None  # URL of the compiled PDF


@dataclass(frozen=True)
class CompileContext:
    pages: list[str]  # SVG markup, one string per page


@dataclass(frozen=True)
class SavedNoteContext:
    target: NoteTarget
    pages: list[str]
    pdf: str
    saved_at: int


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
    report: object | None = None  # backend.corpus.RebuildReport, after a change
    imported_by: tuple[str, ...] = ()  # entries whose code imports this brick


@dataclass(frozen=True)
class VersionContext:
    entry_id: str
    entry_type: str
    author: str
    source: str | None
    code: str | None
    hypotheses: str | None
    limites: str | None


@dataclass(frozen=True)
class EntryPreviewContext:
    pages: list[str]
