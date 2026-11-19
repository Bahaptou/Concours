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


class BrickInUseError(AppError):
    """Deleting a brick that some code still imports: the import must go first."""

    def __init__(self, entry_id: str, imported_by: list[str]):
        self.entry_id = entry_id
        self.imported_by = imported_by

    def __str__(self) -> str:
        return f"La brique « {self.entry_id} » est encore importée par : {', '.join(self.imported_by)}."

    def extensions(self) -> dict:
        return {"entryId": self.entry_id, "importedBy": self.imported_by}


class ImageExistsError(AppError):
    """Adding an image whose name is already taken: images are never replaced."""

    def __init__(self, name: str, link: str):
        self.name = name
        self.link = link  # what to write in a note: ![[<link>]]

    def __str__(self) -> str:
        return f"Une image s'appelle déjà « {self.name} »."

    def extensions(self) -> dict:
        return {"name": self.name, "link": self.link}


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
