"""API routes: one function per route. A route validates its input, calls one service, builds a
context and hands it to a presenter. It never catches application errors: they propagate to the
handler, which turns them into problem details.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import Callable

from backend.compiler import TypstCompiler
from backend.errors import RouteNotFoundError
from backend.corpus import CorpusService
from backend.images import ImagesService
from backend.http.context import (
    CompileContext,
    CorpusContext,
    EntryContext,
    EntryPreviewContext,
    ImageContext,
    ImagesContext,
    NoteContext,
    RunContext,
    SavedNoteContext,
    VersionContext,
)
from backend.http.payload import (
    parse_author,
    parse_entry_id,
    parse_entry_preview,
    parse_image_payload,
    parse_meta_payload,
    parse_new_entry,
    parse_note_target,
    parse_run_payload,
    parse_source_payload,
    parse_version_payload,
)
from backend.http.presenter import (
    CompilePresenter,
    CorpusPresenter,
    DeletedEntryPresenter,
    EntryPresenter,
    EntryPreviewPresenter,
    HealthPresenter,
    ImagePresenter,
    ImagesPresenter,
    NotePresenter,
    RootPresenter,
    RunPresenter,
    SavedNotePresenter,
    VersionPresenter,
)
from backend.notes import NotesService, NoteTarget
from backend.simulations import SimulationRunner


@dataclass(frozen=True)
class Services:
    notes: NotesService
    compiler: TypstCompiler
    corpus: CorpusService
    simulations: SimulationRunner
    images: ImagesService
    static_root: Path  # to turn files on disk into URLs


@dataclass(frozen=True)
class ApiRequest:
    method: str
    path: str
    params: dict[str, str]
    body: bytes


@dataclass(frozen=True)
class ApiResponse:
    status: HTTPStatus
    payload: dict


@dataclass(frozen=True)
class Route:
    method: str
    pattern: re.Pattern
    name: str
    handler: Callable[[ApiRequest, Services], ApiResponse]


def url_of(path: Path, services: Services) -> str:
    return "/" + path.relative_to(services.static_root).as_posix()


# ---------------------------------------------------------------- handlers


def api_root(request: ApiRequest, services: Services) -> ApiResponse:
    return ApiResponse(HTTPStatus.OK, RootPresenter().present())


def health(request: ApiRequest, services: Services) -> ApiResponse:
    return ApiResponse(HTTPStatus.OK, HealthPresenter().present())


def note_context(target: NoteTarget, services: Services) -> NoteContext:
    pdf = services.notes.pdf_path(target)
    return NoteContext(
        target=target,
        source=services.notes.load(target),
        pages=[url_of(p, services) for p in services.notes.page_paths(target)],
        pdf=url_of(pdf, services) if pdf.exists() else None,
    )


def get_note(request: ApiRequest, services: Services) -> ApiResponse:
    target = parse_note_target(request.params["reading"], request.params["author"])
    return ApiResponse(HTTPStatus.OK, NotePresenter().present(note_context(target, services)))


def compile_source(request: ApiRequest, services: Services) -> ApiResponse:
    payload = parse_source_payload(request.body)
    ctx = CompileContext(pages=services.compiler.svg_pages(payload.source))
    return ApiResponse(HTTPStatus.OK, CompilePresenter().present(ctx))


def save_note(request: ApiRequest, services: Services) -> ApiResponse:
    target = parse_note_target(request.params["reading"], request.params["author"])
    payload = parse_source_payload(request.body)
    saved = services.notes.save(target, payload.source)
    ctx = SavedNoteContext(
        target=target,
        pages=[url_of(p, services) for p in services.notes.page_paths(target)],
        pdf=url_of(services.notes.pdf_path(target), services),
        saved_at=saved.saved_at,
    )
    return ApiResponse(HTTPStatus.OK, SavedNotePresenter().present(ctx))


# ---------------------------------------------------------------- corpus


def list_corpus(request: ApiRequest, services: Services) -> ApiResponse:
    ctx = CorpusContext(entries=services.corpus.list())
    return ApiResponse(HTTPStatus.OK, CorpusPresenter().present(ctx, services.notes.root))


def entry_response(status: HTTPStatus, entry, services: Services, report=None) -> ApiResponse:
    ctx = EntryContext(
        entry=entry,
        dependents=services.corpus.dependents(entry.id),
        report=report,
        imported_by=tuple(services.corpus.importers(entry.id)),
    )
    return ApiResponse(status, EntryPresenter().present(ctx, services.notes.root))


def create_entry(request: ApiRequest, services: Services) -> ApiResponse:
    entry_id, meta = parse_new_entry(request.body)
    entry, report = services.corpus.create(entry_id, meta)
    return entry_response(HTTPStatus.CREATED, entry, services, report)


def get_entry(request: ApiRequest, services: Services) -> ApiResponse:
    return entry_response(HTTPStatus.OK, services.corpus.get(parse_entry_id(request.params["id"])), services)


def update_entry(request: ApiRequest, services: Services) -> ApiResponse:
    entry_id = parse_entry_id(request.params["id"])
    entry, report = services.corpus.update_meta(entry_id, parse_meta_payload(request.body))
    return entry_response(HTTPStatus.OK, entry, services, report)


def delete_entry(request: ApiRequest, services: Services) -> ApiResponse:
    entry_id = parse_entry_id(request.params["id"])
    report = services.corpus.delete(entry_id)
    return ApiResponse(HTTPStatus.OK, DeletedEntryPresenter().present(entry_id, report))


def get_version(request: ApiRequest, services: Services) -> ApiResponse:
    entry_id, author = parse_entry_id(request.params["id"]), parse_author(request.params["author"])
    files = services.corpus.load_version(entry_id, author)
    entry = services.corpus.get(entry_id)
    ctx = VersionContext(entry_id, entry.meta.type, author, files.source, files.code, files.hypotheses, files.limites)
    return ApiResponse(HTTPStatus.OK, VersionPresenter().present(ctx))


def save_version(request: ApiRequest, services: Services) -> ApiResponse:
    entry_id, author = parse_entry_id(request.params["id"]), parse_author(request.params["author"])
    payload = parse_version_payload(request.body)
    entry, report = services.corpus.save_version(
        entry_id, author, payload.name, payload.initials, payload.source, payload.code, payload.hypotheses, payload.limites
    )
    return entry_response(HTTPStatus.OK, entry, services, report)


def run_code(request: ApiRequest, services: Services) -> ApiResponse:
    payload = parse_run_payload(request.body)
    result = services.simulations.run(payload.code, payload.author, payload.timeout)
    return ApiResponse(HTTPStatus.OK, RunPresenter().present(RunContext(result)))


def preview_entry(request: ApiRequest, services: Services) -> ApiResponse:
    payload = parse_entry_preview(request.body)
    pages = services.corpus.preview(payload.type, payload.titre, payload.initials, payload.source, payload.hypotheses, payload.limites)
    return ApiResponse(HTTPStatus.OK, EntryPreviewPresenter().present(EntryPreviewContext(pages)))


# ---------------------------------------------------------------- images


def list_images(request: ApiRequest, services: Services) -> ApiResponse:
    images = services.images.list()
    ctx = ImagesContext(images, {image.name: url_of(image.path, services) for image in images})
    return ApiResponse(HTTPStatus.OK, ImagesPresenter().present(ctx))


def add_image(request: ApiRequest, services: Services) -> ApiResponse:
    payload = parse_image_payload(request.body)
    image = services.images.save(payload.name, payload.format, payload.data)
    return ApiResponse(HTTPStatus.CREATED, ImagePresenter().present(ImageContext(image, url_of(image.path, services))))


# ---------------------------------------------------------------- routing table

NOTE = r"^/api/notes/(?P<reading>[^/]+)/(?P<author>[^/]+)$"
ENTRY = r"^/api/corpus/(?P<id>[^/]+)$"
VERSION = r"^/api/corpus/(?P<id>[^/]+)/(?P<author>[^/]+)$"

ROUTES = [
    Route("GET", re.compile(r"^/api/?$"), "api_root", api_root),
    Route("GET", re.compile(r"^/api/health$"), "health", health),
    Route("POST", re.compile(r"^/api/compile$"), "compile", compile_source),
    Route("GET", re.compile(NOTE), "note", get_note),
    Route("PUT", re.compile(NOTE), "save_note", save_note),
    Route("GET", re.compile(r"^/api/corpus$"), "corpus", list_corpus),
    Route("POST", re.compile(r"^/api/corpus$"), "create_entry", create_entry),
    Route("POST", re.compile(r"^/api/compile/entry$"), "preview_entry", preview_entry),
    Route("POST", re.compile(r"^/api/run$"), "run", run_code),
    Route("GET", re.compile(r"^/api/images$"), "images", list_images),
    Route("POST", re.compile(r"^/api/images$"), "add_image", add_image),
    Route("GET", re.compile(ENTRY), "entry", get_entry),
    Route("PUT", re.compile(ENTRY), "update_entry", update_entry),
    Route("DELETE", re.compile(ENTRY), "delete_entry", delete_entry),
    Route("GET", re.compile(VERSION), "version", get_version),
    Route("PUT", re.compile(VERSION), "save_version", save_version),
]


def resolve(method: str, path: str) -> tuple[Route, dict[str, str]]:
    for route in ROUTES:
        match = route.pattern.match(path)
        if match and route.method == method:
            return route, match.groupdict()
    raise RouteNotFoundError(method, path)
