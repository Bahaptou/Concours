"""Request guard: the server only answers the site it serves.

The server writes files and runs Python code on this machine, and any web page open in the
browser can send requests to 127.0.0.1. So, before any routing:

- ``Host`` must be this server (``127.0.0.1:<port>`` or ``localhost:<port>``): this defeats DNS
  rebinding, where a foreign domain is made to resolve to 127.0.0.1 to read the answers;
- ``Origin``, when the browser sends one, must be this server;
- writes must declare ``application/json``: a foreign page cannot send that type without a CORS
  preflight, and this server never grants one.

Requests without ``Origin`` (scripts, tests, curl) are accepted: they do not come from a page.
"""
from __future__ import annotations

from collections.abc import Mapping

from backend.errors import ForbiddenRequestError, UnsupportedMediaTypeError

LOCAL_HOSTS = ("127.0.0.1", "localhost")
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
JSON = "application/json"


def allowed_hosts(port: int) -> set[str]:
    return {f"{host}:{port}" for host in LOCAL_HOSTS}


def check_host(host: str | None, port: int) -> None:
    if (host or "").lower() not in allowed_hosts(port):
        raise ForbiddenRequestError("hôte non autorisé")


def check_source(headers: Mapping[str, str], port: int) -> None:
    """Host and Origin: checked before routing, whatever the method."""
    check_host(headers.get("Host"), port)
    origin = headers.get("Origin")
    if origin is not None and origin.lower() not in {f"http://{host}" for host in allowed_hosts(port)}:
        raise ForbiddenRequestError("origine non autorisée")


def check_content_type(method: str, headers: Mapping[str, str]) -> None:
    """Writes must declare JSON: checked once the route is known (an unknown route stays a 404)."""
    if method in WRITE_METHODS:
        content_type = (headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != JSON:
            raise UnsupportedMediaTypeError(content_type or "aucun")
