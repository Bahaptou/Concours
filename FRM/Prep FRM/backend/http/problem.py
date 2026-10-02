"""RFC 9457 problem details: the single place that maps application errors to HTTP.

Handlers never pick a status code for an error themselves: they let the exception propagate
and ``build_problem_details`` resolves it. Unknown exceptions become a generic 500 that never
leaks the internal message.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from http import HTTPStatus

from backend.errors import (
    AppError,
    CorpusImportForbiddenError,
    EntryExistsError,
    ForbiddenRequestError,
    InvalidRequestError,
    NotFoundError,
    PayloadTooLargeError,
    SimulationRunnerError,
    StorageError,
    TypstCompileError,
    UnknownEntryError,
    UnsupportedMediaTypeError,
)


class ErrorTitle:
    """Stable error codes: the client tests these, never the human message."""

    INVALID_REQUEST_PAYLOAD = "INVALID_REQUEST_PAYLOAD"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    FORBIDDEN_REQUEST = "FORBIDDEN_REQUEST"
    UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE"
    NOT_FOUND = "NOT_FOUND"
    ENTRY_NOT_FOUND = "ENTRY_NOT_FOUND"
    ENTRY_CONFLICT = "ENTRY_CONFLICT"
    CORPUS_IMPORT_FORBIDDEN = "CORPUS_IMPORT_FORBIDDEN"
    TYPST_COMPILE_ERROR = "TYPST_COMPILE_ERROR"
    STORAGE_ERROR = "STORAGE_ERROR"
    RUNNER_ERROR = "RUNNER_ERROR"
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"


@dataclass(frozen=True)
class ErrorMapping:
    status: HTTPStatus
    title: str
    detail: str | None = None  # None: use str(exc)


EXCEPTION_MAPPING: dict[type[Exception], ErrorMapping] = {
    InvalidRequestError: ErrorMapping(HTTPStatus.UNPROCESSABLE_ENTITY, ErrorTitle.INVALID_REQUEST_PAYLOAD),
    PayloadTooLargeError: ErrorMapping(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, ErrorTitle.PAYLOAD_TOO_LARGE),
    ForbiddenRequestError: ErrorMapping(HTTPStatus.FORBIDDEN, ErrorTitle.FORBIDDEN_REQUEST),
    UnsupportedMediaTypeError: ErrorMapping(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, ErrorTitle.UNSUPPORTED_MEDIA_TYPE),
    NotFoundError: ErrorMapping(HTTPStatus.NOT_FOUND, ErrorTitle.NOT_FOUND),
    UnknownEntryError: ErrorMapping(HTTPStatus.NOT_FOUND, ErrorTitle.ENTRY_NOT_FOUND),
    EntryExistsError: ErrorMapping(HTTPStatus.CONFLICT, ErrorTitle.ENTRY_CONFLICT),
    CorpusImportForbiddenError: ErrorMapping(HTTPStatus.UNPROCESSABLE_ENTITY, ErrorTitle.CORPUS_IMPORT_FORBIDDEN),
    TypstCompileError: ErrorMapping(HTTPStatus.UNPROCESSABLE_ENTITY, ErrorTitle.TYPST_COMPILE_ERROR),
    SimulationRunnerError: ErrorMapping(
        HTTPStatus.INTERNAL_SERVER_ERROR, ErrorTitle.RUNNER_ERROR, "Le serveur n'a pas pu lancer Python."
    ),
    StorageError: ErrorMapping(
        HTTPStatus.INTERNAL_SERVER_ERROR, ErrorTitle.STORAGE_ERROR, "Lecture ou écriture impossible sur le disque."
    ),
}

RESERVED_MEMBERS = frozenset({"type", "status", "title", "detail", "instance"})  # RFC 9457

UNEXPECTED = ErrorMapping(HTTPStatus.INTERNAL_SERVER_ERROR, ErrorTitle.INTERNAL_SERVER_ERROR, "Erreur inattendue du serveur.")


@dataclass(frozen=True)
class ProblemDetails:
    status: int
    title: str
    detail: str
    instance: str
    type: str = "about:blank"
    extensions: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        # Standard members come last so that an extension can never overwrite them.
        return {
            **self.extensions,
            "type": self.type,
            "status": self.status,
            "title": self.title,
            "detail": self.detail,
            "instance": self.instance,
        }


def find_mapping(exc: Exception) -> ErrorMapping | None:
    """Most specific mapping, following the exception's MRO (independent of the dict order)."""
    return next((EXCEPTION_MAPPING[cls] for cls in type(exc).__mro__ if cls in EXCEPTION_MAPPING), None)


def build_problem_details(exc: Exception, instance: str) -> ProblemDetails:
    mapping = find_mapping(exc) if isinstance(exc, AppError) else None
    if mapping is None:
        return ProblemDetails(int(UNEXPECTED.status), UNEXPECTED.title, UNEXPECTED.detail, instance)
    return ProblemDetails(
        status=int(mapping.status),
        title=mapping.title,
        detail=mapping.detail or str(exc),
        instance=instance,
        extensions=exc.extensions(),
    )
