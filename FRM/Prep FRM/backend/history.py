"""Who created and changed each shared text, read from git (choice of Baptiste, 2026-11-19).

Notes and entries are Markdown files that Obsidian edits too: a journal written by the site would
miss those changes. git sees them all, and each of us commits under their own name. A commit is
one "session" of the former journal: same shape ({author, name, initials, start, end, saves,
creation}), so that the pages kept their display and their "Contributeur" filters.

Older paths count too (``notes/corpus/<id>/…``, ``notes/r<N>/…``, before the move to Markdown), so
that a text keeps its history. Changes not committed yet are only flagged (``modified``): their
author is unknown until the commit.

Without git (or outside a repository) every history is empty: the site works the same.
"""
from __future__ import annotations

import logging
import re
import subprocess
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

RECORD = "\x1e"
UNIT = "\x1f"
TIMEOUT = 15  # seconds

# Paths relative to notes/ -> (kind, key).
ENTRY_PATHS = (re.compile(r"^corpus/(?P<key>[a-z0-9][a-z0-9-]*)\.md$"), re.compile(r"^corpus/(?P<key>[a-z0-9][a-z0-9-]*)/"))
NOTE_PATHS = (re.compile(r"^fiches/r(?P<key>\d+)\.md$"), re.compile(r"^r(?P<key>\d+)/"))


def text_of(path: str) -> tuple[str, str] | None:
    """("entry", id) or ("note", reading) for a path relative to notes/; None for other files."""
    for kind, patterns in (("entry", ENTRY_PATHS), ("note", NOTE_PATHS)):
        for pattern in patterns:
            if match := pattern.match(path):
                return kind, match["key"]
    return None


def slug(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-") or "inconnu"


def initials(name: str) -> str:
    words = [w for w in re.split(r"[\s._-]+", name) if w and w[0].isalpha()]
    if len(words) >= 2:
        return (words[0][0] + words[-1][0]).upper()
    return (words[0][:2] if words else "?").upper()


@dataclass(frozen=True)
class Commit:
    name: str
    email: str
    time: int  # ms since the epoch


@dataclass
class Snapshot:
    """Histories of every text at one moment: one git call for a whole manifest."""

    commits: dict[tuple[str, str], list[Commit]] = field(default_factory=dict)  # oldest first
    modified: set[tuple[str, str]] = field(default_factory=set)

    def sessions(self, kind: str, key: str | int) -> list[dict]:
        """The commits of a text, in the former journal's shape (the first one is the creation)."""
        found = self.commits.get((kind, str(key)), [])
        return [
            {
                "author": slug(c.name),
                "name": c.name,
                "initials": initials(c.name),
                "start": c.time,
                "end": c.time,
                "saves": 1,
                "creation": index == 0,
            }
            for index, c in enumerate(found)
        ]

    def updated_at(self, kind: str, key: str | int) -> int:
        found = self.commits.get((kind, str(key)), [])
        return found[-1].time if found else 0

    def is_modified(self, kind: str, key: str | int) -> bool:
        return (kind, str(key)) in self.modified


class HistoryService:
    def __init__(self, notes_root: Path):
        self.notes_root = notes_root

    def _git(self, *args: str) -> str | None:
        try:
            result = subprocess.run(
                ["git", "-c", "core.quotepath=off", *args],
                cwd=self.notes_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=TIMEOUT,
            )
        except (OSError, subprocess.SubprocessError) as error:
            logger.warning("git unavailable: %s", error)
            return None
        return result.stdout if result.returncode == 0 else None

    def snapshot(self) -> Snapshot:
        snapshot = Snapshot()
        if not self.notes_root.exists():
            return snapshot
        prefix = self._git("rev-parse", "--show-prefix")  # notes/ relative to the repository root
        if prefix is None:
            return snapshot
        prefix = prefix.strip()
        log = self._git("log", f"--format={RECORD}%an{UNIT}%ae{UNIT}%at", "--name-only", "--no-renames", "--", ".")
        for record in (log or "").split(RECORD)[1:]:
            head, _, files = record.partition("\n")
            name, email, timestamp = head.split(UNIT)
            commit = Commit(name.strip(), email.strip(), int(timestamp) * 1000)
            texts = {text_of(path[len(prefix):]) for path in files.splitlines() if path.startswith(prefix)}
            for text in texts - {None}:
                snapshot.commits.setdefault(text, []).insert(0, commit)  # git log goes newest first
        status = self._git("status", "--porcelain=v1", "--untracked-files=all", "--", ".")
        for line in (status or "").splitlines():
            path = line[3:].split(" -> ")[-1].strip('"')
            if path.startswith(prefix) and (text := text_of(path[len(prefix):])):
                snapshot.modified.add(text)
        return snapshot
