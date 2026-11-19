"""Markdown files shared with Obsidian: a YAML header (front matter) and a body.

The site and Obsidian write the same files. The site only ever changes the header keys it knows
(type, titre, readings, questions, variables, reading…): every other key, its order and comments
survive a save (ruamel.yaml round-trip), so that what Obsidian adds (tags, aliases…) is never lost.

The body of a corpus entry may end with sections the site edits in fields of their own:
``## Hypothèses`` and ``## Limites`` (formulas), ``## Code`` (simulations and bricks, one fenced
Python block). They are recognised only at the end of the body: every level-1 or level-2 heading
after the first of them must be one of them, so a heading written in the text stays in the text.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

DELIMITER = "---"
HEADING = re.compile(r"^(#{1,2})\s+(.+?)\s*#*\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")
SECTION_TITLES = {"hypotheses": "Hypothèses", "limites": "Limites", "code": "Code"}
SECTION_KEYS = {title: key for key, title in SECTION_TITLES.items()}


def _yaml() -> YAML:
    yaml = YAML()  # round-trip mode: keeps order, comments and quoting of what it read
    yaml.preserve_quotes = True
    yaml.width = 4096  # never fold a long title over two lines
    yaml.indent(mapping=2, sequence=4, offset=2)  # lists as Obsidian writes them: "  - item"
    return yaml


def split(text: str) -> tuple[str | None, str]:
    """(header text without its delimiters, body); header None when the file has none."""
    if not text.startswith(DELIMITER + "\n") and not text.startswith(DELIMITER + "\r\n"):
        return None, text
    lines = text.splitlines(keepends=True)
    for index in range(1, len(lines)):
        if lines[index].rstrip("\r\n") == DELIMITER:
            return "".join(lines[1:index]), "".join(lines[index + 1:])
    return None, text  # an opening line never closed: not a header


class Document:
    """A Markdown file: its header as an editable mapping, and its body as text."""

    def __init__(self, data: CommentedMap, body: str, header_text: str | None):
        self.data = data
        self.body = body
        self._header_text = header_text  # as read, returned untouched while nothing changes
        self._changed = False

    @classmethod
    def parse(cls, text: str) -> "Document":
        header, body = split(text)
        data = _yaml().load(header) if header and header.strip() else None
        if not isinstance(data, CommentedMap):
            # Empty or not a mapping: start a fresh header, keep the body.
            return cls(CommentedMap(), body, header if header is not None and not header.strip() else None)
        return cls(data, body, header)

    @classmethod
    def new(cls, body: str = "") -> "Document":
        return cls(CommentedMap(), body, None)

    def get(self, key: str, default=None):
        return self.data.get(key, default)

    def set(self, key: str, value) -> None:
        """Sets one key, leaving the others as they are. Lists are written inline ([1, 2]);
        a list of mappings one item per line, each item inline ({id: '33', reading: 1})."""
        if self.data.get(key) == value and key in self.data:
            return
        self.data[key] = _styled(value)
        self._changed = True

    def delete(self, key: str) -> None:
        if key in self.data:
            del self.data[key]
            self._changed = True

    def dump(self) -> str:
        if not self.data and self._header_text is None:
            return self.body
        if self._changed or self._header_text is None:
            stream = io.StringIO()
            _yaml().dump(self.data, stream)
            header = stream.getvalue()
        else:
            header = self._header_text
        if header and not header.endswith("\n"):
            header += "\n"
        return f"{DELIMITER}\n{header}{DELIMITER}\n{self.body}"


def _styled(value):
    if isinstance(value, list):
        seq = CommentedSeq(_styled(item) for item in value)
        if not any(isinstance(item, dict) for item in value):
            seq.fa.set_flow_style()
        return seq
    if isinstance(value, dict):
        mapping = CommentedMap((k, _styled(v)) for k, v in value.items())
        mapping.fa.set_flow_style()
        return mapping
    return value


# ---------------------------------------------------------------- body sections


@dataclass(frozen=True)
class Sections:
    """A body cut into the main text and the recognised sections (None: section absent)."""

    text: str
    hypotheses: str | None = None
    limites: str | None = None
    code: str | None = None


def _headings(body: str) -> list[tuple[int, int, str]]:
    """(line index, level, title) of level-1 and level-2 headings outside fenced code."""
    found, fenced = [], None
    for index, line in enumerate(body.split("\n")):
        fence = FENCE.match(line)
        if fence:
            fenced = None if fenced == fence[1] else (fenced or fence[1])
            continue
        if fenced is None and (match := HEADING.match(line)):
            found.append((index, len(match[1]), match[2]))
    return found


def _strip_blank_lines(text: str) -> str:
    return text.strip("\n").rstrip() if text.strip() else ""


def _code_of(section: str) -> str:
    """The content of the section's first fenced block, or the section itself without a fence."""
    lines = section.split("\n")
    start = next((i for i, line in enumerate(lines) if FENCE.match(line)), None)
    if start is None:
        return _strip_blank_lines(section)
    marker = FENCE.match(lines[start])[1]
    end = next((i for i in range(start + 1, len(lines)) if lines[i].strip().startswith(marker)), len(lines))
    return "\n".join(lines[start + 1:end])


def parse_sections(body: str, recognised: tuple[str, ...]) -> Sections:
    """Cuts the trailing sections named in ``recognised`` ("hypotheses", "limites", "code") off the
    body. Others are left in the text: a definition's ``## Code`` heading is just text."""
    titles = {SECTION_TITLES[key] for key in recognised}
    headings = _headings(body)
    cut = None
    for index, level, title in reversed(headings):
        if level == 2 and title in titles:
            cut = index
        else:
            break
    if cut is None:
        return Sections(text=body)
    lines = body.split("\n")
    parts: dict[str, str] = {}
    starts = [index for index, _, _ in headings if index >= cut] + [len(lines)]
    for start, end in zip(starts, starts[1:]):
        key = SECTION_KEYS[HEADING.match(lines[start])[2]]
        content = "\n".join(lines[start + 1:end])
        parts[key] = _code_of(content) if key == "code" else _strip_blank_lines(content)
    text = "\n".join(lines[:cut]).rstrip()
    return Sections(text=text + "\n" if text else "", **parts)


def join_sections(sections: Sections) -> str:
    """The body holding ``sections``; empty or None sections are left out."""
    body = sections.text.rstrip()
    for key in ("hypotheses", "limites"):
        value = getattr(sections, key)
        if value and value.strip():
            body += f"\n\n## {SECTION_TITLES[key]}\n\n{value.strip()}"
    if sections.code and sections.code.strip():
        body += f"\n\n## {SECTION_TITLES['code']}\n\n```python\n{sections.code.strip(chr(10))}\n```"
    body = body.lstrip("\n")
    return body + "\n" if body else ""
