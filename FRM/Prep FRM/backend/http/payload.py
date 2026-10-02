"""Request validation: turns raw path parameters and bodies into typed values, or raises
``InvalidRequestError`` before any business logic runs."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from backend.corpus import ENTRY_TYPES, EntryMeta
from backend.errors import InvalidRequestError, PayloadTooLargeError
from backend.notes import NoteTarget
from backend.simulations import MAX_TIMEOUT

READINGS = range(1, 63)
AUTHOR = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
ENTRY_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,49}$")
INITIALS = re.compile(r"^[A-ZÀ-ÖØ-Þ]{1,4}$")
TITLE_MAX = 120
NAME_MAX = 80
MAX_BODY = 1_000_000
CODE_MAX = 200_000
MIN_TIMEOUT = 1


@dataclass(frozen=True)
class SourcePayload:
    source: str


@dataclass(frozen=True)
class VersionPayload:
    source: str
    name: str
    initials: str
    code: str | None
    hypotheses: str | None  # None: not sent, left as is; blank: the block is removed
    limites: str | None


@dataclass(frozen=True)
class RunPayload:
    code: str
    author: str
    timeout: float


@dataclass(frozen=True)
class EntryPreviewPayload:
    type: str
    titre: str
    initials: str
    source: str
    hypotheses: str | None
    limites: str | None


# ---------------------------------------------------------------- path parameters


def parse_reading(value: str) -> int:
    if not value.isdigit() or int(value) not in READINGS:
        raise InvalidRequestError("reading", f"entier entre {READINGS.start} et {READINGS.stop - 1} attendu")
    return int(value)


def parse_author(value: str) -> str:
    if not AUTHOR.match(value):
        raise InvalidRequestError("author", "minuscules, chiffres et tirets uniquement (40 caractères au plus)")
    return value


def parse_note_target(reading: str, author: str) -> NoteTarget:
    return NoteTarget(parse_reading(reading), parse_author(author))


def parse_entry_id(value: str) -> str:
    if not ENTRY_ID.match(value):
        raise InvalidRequestError("id", "minuscules, chiffres et tirets, de 2 à 50 caractères (ex. « bayes »)")
    return value


# ---------------------------------------------------------------- bodies


def check_body_size(length: int) -> None:
    if length > MAX_BODY:
        raise PayloadTooLargeError(length, MAX_BODY)


def _json_object(body: bytes) -> dict:
    try:
        data = json.loads(body or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise InvalidRequestError("body", "JSON invalide") from None
    if not isinstance(data, dict):
        raise InvalidRequestError("body", "objet JSON attendu")
    return data


def _text(data: dict, name: str, *, max_length: int | None = None, required: bool = True) -> str | None:
    value = data.get(name)
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise InvalidRequestError(name, "texte attendu")
    if max_length is not None and not 0 < len(value.strip()) <= max_length:
        raise InvalidRequestError(name, f"texte non vide de {max_length} caractères au plus")
    return value


def parse_source_payload(body: bytes) -> SourcePayload:
    return SourcePayload(_text(_json_object(body), "source"))


def _entry_type(data: dict) -> str:
    value = data.get("type")
    if value not in ENTRY_TYPES:
        raise InvalidRequestError("type", f"un de : {', '.join(ENTRY_TYPES)}")
    return value


def _initials(data: dict) -> str:
    value = (_text(data, "initials") or "").strip().upper()
    if not INITIALS.match(value):
        raise InvalidRequestError("initials", "1 à 4 lettres (ex. « BD »)")
    return value


def _meta(data: dict) -> EntryMeta:
    # No readings: they come from the notes using the entry (see backend/corpus.py).
    return EntryMeta(_entry_type(data), _text(data, "titre", max_length=TITLE_MAX).strip())


def parse_new_entry(body: bytes) -> tuple[str, EntryMeta]:
    data = _json_object(body)
    return parse_entry_id(str(data.get("id", ""))), _meta(data)


def parse_meta_payload(body: bytes) -> EntryMeta:
    return _meta(_json_object(body))


def parse_version_payload(body: bytes) -> VersionPayload:
    data = _json_object(body)
    return VersionPayload(
        source=_text(data, "source"),
        name=_text(data, "name", max_length=NAME_MAX).strip(),
        initials=_initials(data),
        code=_text(data, "code", required=False),
        hypotheses=_text(data, "hypotheses", required=False),
        limites=_text(data, "limites", required=False),
    )


def parse_run_payload(body: bytes) -> RunPayload:
    data = _json_object(body)
    code = _text(data, "code")
    if len(code) > CODE_MAX:
        raise InvalidRequestError("code", f"{CODE_MAX} caractères au plus")
    timeout = data.get("timeout", 30)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not MIN_TIMEOUT <= timeout <= MAX_TIMEOUT:
        raise InvalidRequestError("timeout", f"nombre de secondes entre {MIN_TIMEOUT} et {MAX_TIMEOUT:g}")
    # The author picks which version of each brick is imported.
    return RunPayload(code, parse_author(str(data.get("author", ""))), float(timeout))


def parse_entry_preview(body: bytes) -> EntryPreviewPayload:
    data = _json_object(body)
    return EntryPreviewPayload(
        type=_entry_type(data),
        titre=_text(data, "titre", max_length=TITLE_MAX).strip(),
        initials=_initials(data),
        source=_text(data, "source"),
        hypotheses=_text(data, "hypotheses", required=False),
        limites=_text(data, "limites", required=False),
    )
