"""File helpers shared by the services."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_atomic(path: Path, content: str | bytes) -> None:
    """Write through a temporary file then replace: a concurrent reader (a note being compiled
    while the corpus is regenerated) sees the old or the new file, never a half-written one.
    Text is written as UTF-8 with LF line ends; bytes (an image) as they are."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        if isinstance(content, bytes):
            handle = os.fdopen(fd, "wb")
        else:
            handle = os.fdopen(fd, "w", encoding="utf-8", newline="\n")
        with handle:
            handle.write(content)
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise
