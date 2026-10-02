"""Typst compilation service. Knows nothing about HTTP."""
from __future__ import annotations

import re
from pathlib import Path

import typst

from backend.errors import TypstCompileError

# Compiler messages explained in French for the editor's error banner.
EXPLANATIONS = {
    "unknown variable": "Nom inconnu. En mode maths, des lettres collées forment un seul nom : sépare-les par un "
    "espace (« a b ») ou mets le texte entre guillemets.",
    "unclosed delimiter": "Une parenthèse, un crochet ou une accolade n'est pas refermé.",
    "unclosed string": "Des guillemets ne sont pas refermés.",
    "expected expression": "Il manque une valeur après un « # », un « = » ou une virgule.",
    "unexpected": "Caractère inattendu à cet endroit.",
    "file not found": "Fichier introuvable : vérifie le chemin de l'#import.",
}


PANIC = "panicked with: "


def explain(message: str) -> str | None:
    """French explanation of a compiler message. Our own checks (unknown corpus entry…) use
    panic(): their text is already written for the reader."""
    if message.startswith(PANIC):
        return message.removeprefix(PANIC).strip('"')
    return next((text for key, text in EXPLANATIONS.items() if message.startswith(key)), None)


class TypstCompiler:
    """Compiles note sources with ``root`` as the Typst root, so ``/_gabarit.typ`` resolves there."""

    def __init__(self, root: Path):
        self.root = root

    def svg_pages(self, source: str, wrapper: tuple[str, str] = ("", "")) -> list[str]:
        """SVG markup of each page. ``wrapper`` (prelude, suffix) surrounds the source, e.g. to
        render a corpus entry inside its box; error lines still refer to ``source`` itself."""
        output = self._compile(source, "svg", wrapper)
        pages = output if isinstance(output, list) else [output]  # bytes for one page, a list for several
        return [page.decode("utf-8") for page in pages]

    def pdf(self, source: str) -> bytes:
        return self._compile(source, "pdf", ("", ""))

    def _compile(self, source: str, fmt: str, wrapper: tuple[str, str]):
        prelude, suffix = wrapper
        try:
            return self._raw(prelude + source + suffix, fmt)
        except typst.TypstError as error:
            raise TypstCompileError(
                message=error.message,
                hints=list(error.hints or []),
                explanation=explain(error.message),
                line=self.first_failing_line(source, error.message),
            ) from None

    def _raw(self, source: str, fmt: str):
        return typst.compile(source.encode("utf-8"), root=str(self.root), format=fmt)

    def first_failing_line(self, source: str, message: str) -> int | None:
        """Line where the error most likely starts.

        The Python bindings give no position, so: for an unknown name, the first line using it;
        otherwise the shortest prefix of the source that already fails with the same message.
        """
        lines = source.split("\n")
        name = re.match(r"unknown (?:variable|function): (\S+)", message) or re.search(r"du corpus : ([a-z0-9-]+)", message)
        if name:
            pattern = re.compile(rf"(?<![\w-]){re.escape(name.group(1))}(?![\w-])")
            return next((i + 1 for i, line in enumerate(lines) if pattern.search(line)), None)

        def fails(count: int) -> bool:
            try:
                self._raw("\n".join(lines[:count]), "svg")
            except typst.TypstError as error:
                return error.message == message
            return False

        low, high = 1, len(lines)
        if not fails(high):
            return None
        while low < high:  # about log2(lines) compilations, ~100 ms each
            middle = (low + high) // 2
            if fails(middle):
                high = middle
            else:
                low = middle + 1
        return low
