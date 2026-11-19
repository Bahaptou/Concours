"""Presenters: turn a context into the response envelope ``{"data": ..., "links": ...}``.

``links`` lists the actions available from this resource (rel, href, method, title).
"""
from __future__ import annotations

from dataclasses import dataclass

from backend.corpus import entry_to_dict
from backend.http.context import (
    CorpusContext,
    EntryContext,
    ImageContext,
    ImagesContext,
    NoteContext,
    RunContext,
    SavedNoteContext,
    TextContext,
)
from backend.notes import NoteTarget

API_ROOT = "/api"
HEALTH = "/api/health"


def note_href(target: NoteTarget) -> str:
    return f"/api/notes/{target.reading}"


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
            Link("run", RUN, "Exécuter du code Python", "POST"),
        )


class HealthPresenter:
    def present(self) -> dict:
        return envelope({"status": "ok"}, Link("self", HEALTH, "État du serveur"), Link("root", API_ROOT, "Racine de l'API"))


class NotePresenter:
    def present(self, ctx: NoteContext) -> dict:
        href = note_href(ctx.target)
        data = {"exists": ctx.exists, **ctx.note}
        return envelope(data, Link("self", href, "Fiche"), Link("save", href, "Enregistrer la fiche", "PUT"))


class SavedNotePresenter:
    def present(self, ctx: SavedNoteContext) -> dict:
        data = {**ctx.note, "savedAt": ctx.saved_at}
        return envelope(data, Link("self", note_href(ctx.target), "Fiche"))


# ---------------------------------------------------------------- corpus

CORPUS = "/api/corpus"


def entry_href(entry_id: str) -> str:
    return f"{CORPUS}/{entry_id}"


def text_href(entry_id: str) -> str:
    return f"{CORPUS}/{entry_id}/texte"


class CorpusPresenter:
    def present(self, ctx: CorpusContext) -> dict:
        return envelope(
            {"entries": [entry_to_dict(e) for e in ctx.entries]},
            Link("self", CORPUS, "Corpus"),
            Link("create", CORPUS, "Créer une entrée", "POST"),
        )


class EntryPresenter:
    def present(self, ctx: EntryContext) -> dict:
        entry, deps = ctx.entry, ctx.dependents
        data = entry_to_dict(entry) | {
            "citedBy": sorted(deps.entries),
            "importedBy": list(ctx.imported_by),
        }
        links = [
            Link("self", entry_href(entry.id), entry.meta.titre),
            Link("update", entry_href(entry.id), "Modifier l'entrée", "PUT"),
            Link("text", text_href(entry.id), "Texte de l'entrée"),
            Link("corpus", CORPUS, "Corpus"),
        ]
        return envelope(data, *links)


class DeletedEntryPresenter:
    def present(self, entry_id: str, rewritten: list[str]) -> dict:
        return envelope({"deleted": entry_id, "rewritten": rewritten}, Link("corpus", CORPUS, "Corpus"))


class TextPresenter:
    def present(self, ctx: TextContext) -> dict:
        href = text_href(ctx.entry_id)
        data = {
            "entry": ctx.entry_id,
            "type": ctx.entry_type,
            "exists": ctx.source is not None,
            "source": ctx.source,
            "code": ctx.code,
            "hypotheses": ctx.hypotheses,
            "limites": ctx.limites,
            "variables": ctx.variables,
        }
        return envelope(
            data,
            Link("self", href, "Texte de l'entrée"),
            Link("save", href, "Enregistrer le texte", "PUT"),
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
            "bricks": [{"id": b.entry_id, "module": b.module} for b in r.bricks],
        }
        return envelope(data, Link("self", RUN, "Exécuter du code Python", "POST"))


# ---------------------------------------------------------------- math buttons

MATH_TOOLS = "/api/math-tools"


class MathToolsPresenter:
    def present(self, tools) -> dict:
        return envelope(
            {"tools": [tool.to_dict() for tool in tools]},
            Link("self", MATH_TOOLS, "Boutons de maths ajoutés"),
            Link("create", MATH_TOOLS, "Ajouter un bouton", "POST"),
        )


# ---------------------------------------------------------------- images

IMAGES = "/api/images"


def image_to_dict(image, url: str) -> dict:
    return {
        "name": image.name,
        "format": image.format,
        "size": image.size,
        "updatedAt": image.updated_at,
        "url": url,  # to show it in the site
        "link": image.link,  # to write in a note: ![[…]]
    }


class ImagesPresenter:
    def present(self, ctx: ImagesContext) -> dict:
        return envelope(
            {"images": [image_to_dict(image, ctx.urls[image.name]) for image in ctx.images]},
            Link("self", IMAGES, "Images"),
            Link("create", IMAGES, "Ajouter une image", "POST"),
        )


class ImagePresenter:
    def present(self, ctx: ImageContext) -> dict:
        return envelope(image_to_dict(ctx.image, ctx.url), Link("images", IMAGES, "Images"))
