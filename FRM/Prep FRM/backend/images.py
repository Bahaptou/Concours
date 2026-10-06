"""Shared images for notes and corpus entries: one common folder, ``notes/images/``.

Under the Typst root, so that ``#image("/images/courbe-des-taux.png")`` works from a note, from
an entry, and from a note inserting that entry. Typst embeds the image in the SVG and PDF it
produces: pages opened without the server show it too.

An image is never replaced: a name is taken once, whatever the format, so that a note always
shows the image it was written with (its SVG would not change anyway until recompiled). The
browser compresses images before sending them; the server only checks what it receives.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path

from backend.errors import ImageExistsError, InvalidRequestError, StorageError
from backend.files import write_atomic

IMAGE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,59}$")
MAX_IMAGE_BYTES = 4_000_000  # after decoding; the browser aims well below


def _is_svg(data: bytes) -> bool:
    head = data[:1000].lstrip().lower()
    return head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head)


# Formats Typst reads (checked with typst 0.15), recognised by their first bytes, not by the
# extension announced by the client.
FORMATS = {
    "png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
    "jpg": lambda data: data.startswith(b"\xff\xd8\xff"),
    "gif": lambda data: data.startswith((b"GIF87a", b"GIF89a")),
    "webp": lambda data: data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    "svg": _is_svg,
}


@dataclass(frozen=True)
class Image:
    name: str
    format: str
    path: Path
    size: int
    updated_at: int  # ms since the epoch

    @property
    def typst_path(self) -> str:
        """Path to write in a note or an entry: from the Typst root (notes/)."""
        return f"/images/{self.path.name}"


class ImagesService:
    def __init__(self, notes_root: Path):
        self.folder = notes_root / "images"
        self._writes = threading.Lock()

    def _image(self, path: Path) -> Image:
        stat = path.stat()
        return Image(path.stem, path.suffix[1:], path, stat.st_size, int(stat.st_mtime * 1000))

    def _find(self, name: str) -> Path | None:
        return next((p for p in self.folder.glob(f"{name}.*") if p.stem == name and p.suffix[1:] in FORMATS), None)

    def list(self) -> list[Image]:
        if not self.folder.exists():
            return []
        paths = [p for p in self.folder.iterdir() if p.is_file() and p.suffix[1:] in FORMATS and not p.name.startswith(".")]
        return sorted((self._image(p) for p in paths), key=lambda image: image.name)

    def save(self, name: str, image_format: str, data: bytes) -> Image:
        """Writes a new image. Raises ImageExistsError if the name is taken (in any format)."""
        if not IMAGE_NAME.match(name):
            raise InvalidRequestError("name", "minuscules, chiffres et tirets, de 2 à 60 caractères (ex. « courbe-des-taux »)")
        if image_format not in FORMATS:
            raise InvalidRequestError("format", f"un de : {', '.join(FORMATS)}")
        if not data:
            raise InvalidRequestError("data", "image vide")
        if len(data) > MAX_IMAGE_BYTES:
            raise InvalidRequestError("data", f"{len(data) // 1000} Ko, maximum {MAX_IMAGE_BYTES // 1_000_000} Mo")
        if not FORMATS[image_format](data):
            raise InvalidRequestError("data", f"le contenu n'est pas une image {image_format.upper()}")
        with self._writes:
            existing = self._find(name)
            if existing:
                raise ImageExistsError(name, self._image(existing).typst_path)
            path = self.folder / f"{name}.{image_format}"
            try:
                write_atomic(path, data)
            except OSError as error:
                raise StorageError(str(path), str(error)) from error
            return self._image(path)
