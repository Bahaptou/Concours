"""Math buttons added from the editors, shared by everyone: ``notes/_outils-maths.json``.

The built-in buttons of the "Mode maths" bar live in assets/js/editor/toolbar.js; these ones are
added in the browser (label, Typst to insert, optional part to select after insertion) and kept
in the project, so that both of us get them and git keeps them.
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from backend.errors import InvalidRequestError, NotFoundError, StorageError
from backend.files import write_atomic

LABEL_MAX = 16
TYPST_MAX = 200


class UnknownMathToolError(NotFoundError):
    def __init__(self, tool_id: str):
        self.tool_id = tool_id

    def __str__(self) -> str:
        return f"Bouton inconnu : {self.tool_id}"


@dataclass(frozen=True)
class MathTool:
    id: str
    label: str
    typst: str
    select: str | None  # part of `typst` selected after insertion (typed over), or None

    def to_dict(self) -> dict:
        return {"id": self.id, "label": self.label, "typst": self.typst, "select": self.select}


class MathToolsService:
    def __init__(self, notes_root: Path):
        self.path = notes_root / "_outils-maths.json"
        self._writes = threading.Lock()

    def list(self) -> list[MathTool]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise StorageError(str(self.path), str(error)) from error
        return [MathTool(t["id"], t["label"], t["typst"], t.get("select")) for t in raw.get("tools", [])]

    def _write(self, tools: list[MathTool]) -> None:
        payload = {"tools": [tool.to_dict() for tool in tools]}
        try:
            write_atomic(self.path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        except OSError as error:
            raise StorageError(str(self.path), str(error)) from error

    def add(self, label: str, typst: str, select: str | None) -> MathTool:
        label, typst = label.strip(), typst.strip()
        select = select.strip() if select and select.strip() else None
        if not 0 < len(label) <= LABEL_MAX:
            raise InvalidRequestError("label", f"texte non vide de {LABEL_MAX} caractères au plus")
        if not 0 < len(typst) <= TYPST_MAX:
            raise InvalidRequestError("typst", f"texte non vide de {TYPST_MAX} caractères au plus")
        if select is not None and select not in typst:
            raise InvalidRequestError("select", "doit être une partie du Typst inséré")
        with self._writes:
            tools = self.list()
            tool = MathTool(f"t{int(time.time() * 1000):x}", label, typst, select)
            while any(t.id == tool.id for t in tools):  # two additions in the same millisecond
                tool = MathTool(tool.id + "x", label, typst, select)
            self._write([*tools, tool])
        return tool

    def delete(self, tool_id: str) -> None:
        with self._writes:
            tools = self.list()
            if not any(t.id == tool_id for t in tools):
                raise UnknownMathToolError(tool_id)
            self._write([t for t in tools if t.id != tool_id])
