"""Application errors.

Business code raises these and knows nothing about HTTP; ``backend.http.problem`` maps them to
RFC 9457 responses in a single table. Each error carries the data of the failure as attributes
and builds its human message in ``__str__``.
"""
from __future__ import annotations


class AppError(Exception):
    """Base class for application errors."""

    def extensions(self) -> dict:
        """Extra members added to the problem details (RFC 9457 allows them)."""
        return {}


class InvalidRequestError(AppError):
    """A request parameter or payload does not have the expected shape."""

    def __init__(self, field: str, reason: str):
        self.field = field
        self.reason = reason

    def __str__(self) -> str:
        return f"{self.field} : {self.reason}"

    def extensions(self) -> dict:
        return {"field": self.field}


class PayloadTooLargeError(InvalidRequestError):
    def __init__(self, size: int, limit: int):
        super().__init__("body", f"{size} octets, maximum {limit}")
        self.size = size
        self.limit = limit


class ForbiddenRequestError(AppError):
    """The request does not come from the site served by this server (see backend.http.guard)."""

    def __init__(self, reason: str):
        self.reason = reason

    def __str__(self) -> str:
        return f"Requête refusée : {self.reason}. Seul le site servi par ce serveur peut l'appeler."


class UnsupportedMediaTypeError(AppError):
    """A write that does not declare a JSON body."""

    def __init__(self, content_type: str):
        self.content_type = content_type

    def __str__(self) -> str:
        return f"Type de contenu « {self.content_type} » refusé : application/json attendu."

    def extensions(self) -> dict:
        return {"contentType": self.content_type}


class NotFoundError(AppError):
    """Base class for missing resources."""


class RouteNotFoundError(NotFoundError):
    def __init__(self, method: str, path: str):
        self.method = method
        self.path = path

    def __str__(self) -> str:
        return f"Aucune route pour {self.method} {self.path}"


class UnknownEntryError(NotFoundError):
    def __init__(self, entry_id: str):
        self.entry_id = entry_id

    def __str__(self) -> str:
        return f"Entrée inconnue du corpus : {self.entry_id}"


class EntryExistsError(AppError):
    """Creating an entry whose identifier is already taken."""

    def __init__(self, entry_id: str, existing_type: str):
        self.entry_id = entry_id
        self.existing_type = existing_type

    def __str__(self) -> str:
        return f"L'entrée « {self.entry_id} » existe déjà (type {self.existing_type})."

    def extensions(self) -> dict:
        return {"entryId": self.entry_id, "existingType": self.existing_type}


class CorpusImportForbiddenError(InvalidRequestError):
    """An entry may only cite (#voir): importing the full corpus could create an import cycle."""

    def __init__(self):
        super().__init__(
            "source",
            "une entrée du corpus peut citer (#voir) mais pas importer « _corpus.typ » ni insérer une entrée (#entree)",
        )


class TypstCompileError(AppError):
    """The Typst source does not compile: an expected, user-fixable outcome."""

    def __init__(self, message: str, hints: list[str], explanation: str | None, line: int | None, saved: bool = False):
        self.message = message
        self.hints = hints
        self.explanation = explanation
        self.line = line
        self.saved = saved  # True when the source was written to disk before compiling
        # Corpus only: what happened to the notes depending on the failed version (RebuildReport.to_dict()).
        self.rebuild: dict | None = None
        # Corpus only: which text of a version holds the error ("source", "hypotheses" or "limites");
        # ``line`` counts inside that text. None when the failing text is not told apart.
        self.part: str | None = None

    def __str__(self) -> str:
        return self.message

    def extensions(self) -> dict:
        members = {"hints": self.hints, "explanation": self.explanation, "line": self.line, "saved": self.saved}
        if self.rebuild is not None:
            members["rebuild"] = self.rebuild
        if self.part is not None:
            members["part"] = self.part
        return members


class SimulationRunnerError(AppError):
    """The server could not start or prepare the Python process (not an error in the user's code)."""

    def __init__(self, reason: str):
        self.reason = reason

    def __str__(self) -> str:
        return f"Exécution impossible : {self.reason}"


class StorageError(AppError):
    """Technical failure while reading or writing notes on disk."""

    def __init__(self, path: str, reason: str):
        self.path = path
        self.reason = reason

    def __str__(self) -> str:
        return f"Storage failure on {self.path}: {self.reason}"
