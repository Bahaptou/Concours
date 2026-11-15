"""Modification journal of a shared text (a note, a corpus entry): who changed it, and when.

Notes and entries belong to everyone; the journal keeps the interactions between profiles, not
the texts (git keeps those). One ``journal.jsonl`` per note or entry, one JSON object per line:

    {"auteur": "baptiste", "nom": "Baptiste Durand", "initiales": "BD",
     "debut": 1759240000000, "fin": 1759241800000, "enregistrements": 12, "creation": true}

A line is a session: saves by the same person less than ``SESSION_GAP_MS`` apart extend it (notes
save themselves while one types). Only the first line of a text carries ``creation``.

Lines only ever get appended, or the last one extended, and ``notes/.gitattributes`` merges these
files with ``merge=union``: two people working apart get both their lines after a git merge. A line
left twice or garbled by such a merge is tolerated: duplicates and unreadable lines are skipped.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from backend.errors import StorageError
from backend.files import write_atomic

FILE_NAME = "journal.jsonl"
SESSION_GAP_MS = 30 * 60 * 1000


@dataclass(frozen=True)
class Contributor:
    """Who makes a change: the profile of the person at the keyboard."""

    author: str  # slug, e.g. "baptiste"
    name: str
    initials: str


@dataclass(frozen=True)
class Session:
    author: str
    name: str
    initials: str
    start: int  # ms since the epoch
    end: int
    saves: int
    creation: bool = False

    def to_line(self) -> dict:
        line = {
            "auteur": self.author,
            "nom": self.name,
            "initiales": self.initials,
            "debut": self.start,
            "fin": self.end,
            "enregistrements": self.saves,
        }
        if self.creation:
            line["creation"] = True
        return line

    def to_dict(self) -> dict:
        """For the API and the manifests (English keys, like the rest of the payloads)."""
        return {
            "author": self.author,
            "name": self.name,
            "initials": self.initials,
            "start": self.start,
            "end": self.end,
            "saves": self.saves,
            "creation": self.creation,
        }


def _session(data: object) -> Session | None:
    if not isinstance(data, dict):
        return None
    try:
        return Session(
            author=str(data["auteur"]),
            name=str(data["nom"]),
            initials=str(data["initiales"]),
            start=int(data["debut"]),
            end=int(data["fin"]),
            saves=int(data.get("enregistrements", 1)),
            creation=bool(data.get("creation", False)),
        )
    except (KeyError, TypeError, ValueError):
        return None


def read(folder: Path) -> list[Session]:
    """Sessions of the text in ``folder``, oldest first; [] when it has no journal."""
    path = folder / FILE_NAME
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise StorageError(str(path), str(error)) from error
    sessions, seen = [], set()
    for line in lines:
        try:
            session = _session(json.loads(line))
        except json.JSONDecodeError:
            continue
        if session and session not in seen:
            seen.add(session)
            sessions.append(session)
    return sorted(sessions, key=lambda s: (s.start, s.end))


def _write(folder: Path, sessions: list[Session]) -> None:
    path = folder / FILE_NAME
    text = "".join(json.dumps(s.to_line(), ensure_ascii=False) + "\n" for s in sessions)
    try:
        write_atomic(path, text)
    except OSError as error:
        raise StorageError(str(path), str(error)) from error


def record(folder: Path, who: Contributor, now: int, *, creation: bool = False) -> None:
    """Notes a change by ``who`` at ``now``: extends their last session when it is recent and the
    last one of the text, else starts a new line. The caller holds the lock of the text."""
    sessions = read(folder)
    last = sessions[-1] if sessions else None
    if last and not creation and last.author == who.author and 0 <= now - last.end < SESSION_GAP_MS:
        sessions[-1] = Session(last.author, who.name, who.initials, last.start, now, last.saves + 1, last.creation)
    else:
        sessions.append(Session(who.author, who.name, who.initials, now, now, 1, creation or not sessions))
    _write(folder, sessions)


def as_dicts(sessions: list[Session]) -> list[dict]:
    return [s.to_dict() for s in sessions]
