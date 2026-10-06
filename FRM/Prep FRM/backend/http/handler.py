"""HTTP handler: serves the static site and dispatches ``/api/*`` to the routes.

This is the only place where an exception becomes an HTTP response: application errors are
logged as warnings (expected outcomes), technical and unexpected errors with their stack trace.
"""
from __future__ import annotations

import json
import logging
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from urllib.parse import urlparse

from backend.errors import AppError, ForbiddenRequestError, SimulationRunnerError, StorageError
from backend.http.guard import check_content_type, check_host, check_source
from backend.http.payload import check_body_size
from backend.http.problem import build_problem_details
from backend.http.routes import ApiRequest, ApiResponse, Services, resolve

logger = logging.getLogger(__name__)


def make_handler(services: Services) -> type[SimpleHTTPRequestHandler]:
    """Handler class bound to ``services`` (the server instantiates one handler per request)."""

    class Handler(SimpleHTTPRequestHandler):
        # Windows may map .js to text/plain in its registry; browsers then refuse ES modules.
        extensions_map = {
            **SimpleHTTPRequestHandler.extensions_map,
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".svg": "image/svg+xml",
            ".typ": "text/plain; charset=utf-8",
            ".json": "application/json",
        }

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(services.static_root), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")  # edits must show up on reload
            super().end_headers()

        def log_request(self, code="-", size="-"):
            """Log API calls and server errors only. Static files would flood the console, and a
            missing static file is a browser probe or an optional script, not a server problem."""
            status = str(getattr(code, "value", code))
            if self._is_api() or status.startswith("5"):
                super().log_request(code, size)

        def log_error(self, format, *args):  # noqa: A002 - signature imposed by the base class
            if args and args[0] == HTTPStatus.NOT_FOUND and not self._is_api():
                return  # same reason as above: an absent optional file is not an error
            super().log_error(format, *args)

        def do_GET(self):
            if self._is_api():
                return self._handle_api("GET")
            if self._static_host_ok():
                super().do_GET()

        def do_HEAD(self):
            if self._static_host_ok():
                super().do_HEAD()

        def _static_host_ok(self) -> bool:
            """Static files too: they hold the notes and the extracted questions (see guard.py)."""
            try:
                check_host(self.headers.get("Host"), self.server.server_address[1])
            except ForbiddenRequestError as error:
                self.send_error(HTTPStatus.FORBIDDEN, str(error))
                return False
            return True

        def do_POST(self):
            self._handle_api("POST")

        def do_PUT(self):
            self._handle_api("PUT")

        # Unused methods still answer with problem details, not the base class's HTML 501 page.
        def do_DELETE(self):
            self._handle_api("DELETE")

        def do_PATCH(self):
            self._handle_api("PATCH")

        # ---------------------------------------------------------- API

        def _is_api(self) -> bool:
            path = urlparse(self.path).path
            return path == "/api" or path.startswith("/api/")

        def _read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or 0)
            check_body_size(length)
            return self.rfile.read(length)

        def _handle_api(self, method: str) -> None:
            path = urlparse(self.path).path
            try:
                check_source(self.headers, self.server.server_address[1])
                route, params = resolve(method, path)
                check_content_type(method, self.headers)
                body = self._read_body() if method in ("POST", "PUT", "DELETE") else b""  # a body left unread would spoil the next request
                response = route.handler(ApiRequest(method, path, params, body), services)
            except Exception as exc:  # noqa: BLE001 - the single conversion point to problem details
                self._log_error(exc)
                problem = build_problem_details(exc, path)
                self.close_connection = True  # the body may not have been read
                return self._send(problem.status, problem.to_dict(), "application/problem+json")
            self._send(response.status, response.payload, "application/json")

        @staticmethod
        def _log_error(exc: Exception) -> None:
            if isinstance(exc, (StorageError, SimulationRunnerError)) or not isinstance(exc, AppError):
                logger.exception("Server error", exc_info=exc)
            else:
                logger.warning("%s: %s", type(exc).__name__, exc)

        def _send(self, status: int | HTTPStatus, payload: dict, content_type: str) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(int(status))
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler
