"""Presenters: turn a context into the response envelope ``{"data": ..., "links": ...}``.

``links`` lists the actions available from this resource (rel, href, method, title).
"""
from __future__ import annotations

from dataclasses import dataclass

from backend.corpus import entry_to_dict
from backend.http.context import (
    CompileContext,
    CorpusContext,
    EntryContext,
    EntryPreviewContext,
    NoteContext,
    RunContext,
    SavedNoteContext,
    VersionContext,
)
from backend.notes import NoteTarget

API_ROOT = "/api"
HEALTH = "/api/health"
COMPILE = "/api/compile"


def note_href(target: NoteTarget) -> str:
    return f"/api/notes/{target.reading}/{target.author}"


@dataclass(frozen=True)
class Link:
    rel: str
    href: str
    title: str
    method: str = "GET"

    def to_dict(self) -> dict:
        return {"rel": self.rel, "href": self.href, "method": self.method, "title": self.title}


def envelope(data: dict, *links: Link) -> dict:
    return {"data": data, "links": {link.rel: link.to_dict() for link in links}}


class RootPresenter:
    def present(self) -> dict:
        return envelope(
            {"name": "prep-frm"},
            Link("self", API_ROOT, "Racine de l'API"),
            Link("health", HEALTH, "État du serveur"),
            Link("compile", COMPILE, "Compiler une source Typst", "POST"),
            Link("run", RUN, "Exécuter du code Python", "POST"),
        )


class HealthPresenter:
    def present(self) -> dict:
        return envelope({"status": "ok"}, Link("self", HEALTH, "État du serveur"), Link("root", API_ROOT, "Racine de l'API"))


class NotePresenter:
    def present(self, ctx: NoteContext) -> dict:
        href = note_href(ctx.target)
        links = [
            Link("self", href, "Fiche"),
            Link("save", href, "Enregistrer la fiche", "PUT"),
            Link("compile", COMPILE, "Aperçu de la fiche", "POST"),
        ]
        if ctx.pdf:
            links.append(Link("pdf", ctx.pdf, "Fiche en PDF"))
        data = {
            "reading": ctx.target.reading,
            "author": ctx.target.author,
            "exists": ctx.source is not None,
            "source": ctx.source,
            "pages": ctx.pages,
            "pdf": ctx.pdf,
        }
        return envelope(data, *links)


class CompilePresenter:
    def present(self, ctx: CompileContext) -> dict:
        return envelope({"pages": ctx.pages}, Link("self", COMPILE, "Compiler une source Typst", "POST"))


class SavedNotePresenter:
    def present(self, ctx: SavedNoteContext) -> dict:
        href = note_href(ctx.target)
        data = {
            "reading": ctx.target.reading,
            "author": ctx.target.author,
            "pages": ctx.pages,
            "pdf": ctx.pdf,
            "savedAt": ctx.saved_at,
        }
        return envelope(data, Link("self", href, "Fiche"), Link("pdf", ctx.pdf, "Fiche en PDF"))


# ---------------------------------------------------------------- corpus

CORPUS = "/api/corpus"
ENTRY_PREVIEW = "/api/compile/entry"


def entry_href(entry_id: str) -> str:
    return f"{CORPUS}/{entry_id}"


def version_href(entry_id: str, author: str) -> str:
    return f"{CORPUS}/{entry_id}/{author}"


class CorpusPresenter:
    def present(self, ctx: CorpusContext, notes_root) -> dict:
        return envelope(
            {"entries": [entry_to_dict(e, notes_root) for e in ctx.entries]},
            Link("self", CORPUS, "Corpus"),
            Link("create", CORPUS, "Créer une entrée", "POST"),
            Link("preview", ENTRY_PREVIEW, "Aperçu d'une version", "POST"),
        )


class EntryPresenter:
    def present(self, ctx: EntryContext, notes_root) -> dict:
        entry, deps = ctx.entry, ctx.dependents
        data = entry_to_dict(entry, notes_root) | {
            "citedBy": sorted({entry_id for entry_id, _ in deps.entries}),
            "importedBy": list(ctx.imported_by),
        }
        if ctx.report is not None:
            data["rebuild"] = ctx.report.to_dict()
        links = [
            Link("self", entry_href(entry.id), entry.meta.titre),
            Link("update", entry_href(entry.id), "Modifier l'entrée", "PUT"),
            Link("preview", ENTRY_PREVIEW, "Aperçu d'une version", "POST"),
            Link("corpus", CORPUS, "Corpus"),
        ]
        links += [Link(f"version:{v.author}", version_href(entry.id, v.author), f"Version de {v.name}") for v in entry.versions]
        return envelope(data, *links)


class VersionPresenter:
    def present(self, ctx: VersionContext) -> dict:
        href = version_href(ctx.entry_id, ctx.author)
        data = {
            "entry": ctx.entry_id,
            "type": ctx.entry_type,
            "author": ctx.author,
            "exists": ctx.source is not None,
            "source": ctx.source,
            "code": ctx.code,
        }
        return envelope(
            data,
            Link("self", href, "Version"),
            Link("save", href, "Enregistrer la version", "PUT"),
            Link("preview", ENTRY_PREVIEW, "Aperçu de la version", "POST"),
            Link("entry", entry_href(ctx.entry_id), "Entrée"),
        )


RUN = "/api/run"


class RunPresenter:
    def present(self, ctx: RunContext) -> dict:
        r = ctx.result
        data = {
            "ok": r.ok,
            "stdout": r.stdout,
            "stderr": r.stderr,
            "error": r.error,
            "figures": r.figures,
            "durationMs": r.duration_ms,
            "timedOut": r.timed_out,
            "bricks": [{"id": b.entry_id, "module": b.module, "author": b.author} for b in r.bricks],
        }
        return envelope(data, Link("self", RUN, "Exécuter du code Python", "POST"))


class EntryPreviewPresenter:
    def present(self, ctx: EntryPreviewContext) -> dict:
        return envelope({"pages": ctx.pages}, Link("self", ENTRY_PREVIEW, "Aperçu d'une version", "POST"))
