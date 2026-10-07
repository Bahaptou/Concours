"""File helpers shared by the services.

On Windows, another program may hold a project file for a moment: git maps the files it reads
into memory (and the editor runs `git status` right after each change), an antivirus scans a
file just written. Replacing or deleting the file then fails (EINVAL, EACCES) although nothing is
wrong; it succeeds a few hundred milliseconds later. Every write and delete in the project goes
through these helpers, which retry briefly before giving up.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Callable, TypeVar

T = TypeVar("T")

RETRY_DELAYS = (0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.0)  # seconds; about 3 s in all before giving up


def retrying(action: Callable[[], T]) -> T:
    """Runs a file operation, retrying on OSError while another program holds the file."""
    for delay in RETRY_DELAYS:
        try:
            return action()
        except FileNotFoundError:
            raise  # not a transient lock
        except OSError:
            time.sleep(delay)
    return action()  # last try: its error goes to the caller


def write_atomic(path: Path, content: str | bytes) -> None:
    """Write through a temporary file then replace: a concurrent reader (a note being compiled
    while the corpus is regenerated) sees the old or the new file, never a half-written one.
    Text is written as UTF-8 with LF line ends; bytes (an image, a PDF) as they are."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        if isinstance(content, bytes):
            handle = os.fdopen(fd, "wb")
        else:
            handle = os.fdopen(fd, "w", encoding="utf-8", newline="\n")
        with handle:
            handle.write(content)
        retrying(lambda: os.replace(temp, path))
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def remove(path: Path) -> None:
    """Deletes a file if it exists."""
    retrying(lambda: path.unlink(missing_ok=True))


def remove_tree(path: Path) -> None:
    """Deletes a folder and its content (an entry of the corpus)."""
    retrying(lambda: shutil.rmtree(path) if path.exists() else None)
