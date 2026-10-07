"""Runs simulation (and brick) code on this machine, in a separate Python process.

Each run gets a fresh temporary folder: the code as ``main.py``, every brick of the corpus as
``briques/<module>.py`` (each brick has one shared code: ``CorpusService.brick_sources``), the
financial products as ``produits.py`` (``from produits import produit``: an object to fill),
and a small runner script. The child process uses the project's Python (numpy, scipy, pandas,
matplotlib), in isolated mode, with a time limit; matplotlib draws without a window (Agg) and the
runner saves the figures still open at the end.

An error in the code is a result, not a failure of the service: ``RunResult.ok`` is False and
``error`` says where. Only the service failing to start a process raises.

This is not a sandbox: the code can do what the user can (read files, use the network). The
server only accepts code from its own site (backend.http.guard), and runs what the user wrote.
"""
from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from backend.corpus import CorpusService, brick_imports
from backend.errors import SimulationRunnerError

DEFAULT_TIMEOUT = 30.0
MAX_TIMEOUT = 300.0
MAX_OUTPUT = 100_000  # characters kept from stdout and stderr each
MAX_FIGURES = 20
PARALLEL_RUNS = 2  # more would slow every run down on a laptop
MAX_FIGURE_PIXELS = 3000  # longest side of a saved figure: a huge figsize must not bloat the answer
# Environment of the child: only what Python and matplotlib need, never the server's own variables
# (a key added there one day for another feature would otherwise be readable by any simulation).
INHERITED_ENV = ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG")
# matplotlib's font cache, kept between runs (building it takes seconds).
MPL_CACHE = Path(tempfile.gettempdir()) / "prep-frm-matplotlib"

RUNNER = '''"""Runs main.py, then writes _result.json: error (type, message, line) and saved figures."""
import json, os, runpy, sys, traceback

sys.path.insert(0, os.getcwd())  # isolated mode does not add it: the bricks live here
result = {"error": None, "figures": []}


def own_frame(frame):
    name = os.path.relpath(frame.filename, os.getcwd()).replace(os.sep, "/")
    return name == "main.py" or name.startswith("briques/")


try:
    runpy.run_path("main.py", run_name="__main__")
except SystemExit as exit_:
    if exit_.code not in (None, 0):
        result["error"] = {"type": "SystemExit", "message": str(exit_.code), "line": None}
except BaseException as error:  # noqa: BLE001 - every error of the user's code is reported
    frames = traceback.extract_tb(error.__traceback__)
    line = next((f.lineno for f in reversed(frames) if os.path.basename(f.filename) == "main.py"), None)
    if line is None and isinstance(error, SyntaxError) and os.path.basename(error.filename or "") == "main.py":
        line = error.lineno
    result["error"] = {"type": type(error).__name__, "message": str(error), "line": line}
    report = traceback.TracebackException.from_exception(error)
    report.stack = traceback.StackSummary.from_list([f for f in report.stack if own_frame(f)])
    sys.stderr.write("".join(report.format()))
finally:
    if "matplotlib.pyplot" in sys.modules:
        import matplotlib.pyplot as plt
        for index, number in enumerate(plt.get_fignums()[:%(max_figures)d], 1):
            figure = plt.figure(number)
            name = f"_figure-{index}.png"
            dpi = min(110, %(max_pixels)d / max(figure.get_size_inches()))
            figure.savefig(name, dpi=dpi, bbox_inches="tight")
            result["figures"].append(name)
    with open("_result.json", "w", encoding="utf-8") as out:
        json.dump(result, out)
''' % {"max_figures": MAX_FIGURES, "max_pixels": MAX_FIGURE_PIXELS}


@dataclass(frozen=True)
class UsedBrick:
    entry_id: str
    module: str


@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False
    error: dict | None = None  # {"type", "message", "line"}: line in the code that was run
    figures: list[str] = field(default_factory=list)  # PNG data URLs
    bricks: list[UsedBrick] = field(default_factory=list)


def used_bricks(code: str, bricks) -> list[UsedBrick]:
    """Bricks the code imports, directly or through other bricks (the others are present but unused)."""
    by_id = {brick.entry_id: brick for brick in bricks}
    seen, pending = set(), list(brick_imports(code))
    while pending:
        entry_id = pending.pop()
        if entry_id in seen or entry_id not in by_id:
            continue
        seen.add(entry_id)
        pending.extend(brick_imports(by_id[entry_id].code))
    return [UsedBrick(b.entry_id, b.module) for b in bricks if b.entry_id in seen]


def child_env() -> dict[str, str]:
    env = {name: os.environ[name] for name in INHERITED_ENV if name in os.environ}
    return env | {"MPLBACKEND": "Agg", "MPLCONFIGDIR": str(MPL_CACHE)}


def kill_tree(process: subprocess.Popen) -> None:
    """Stop the process and the ones it started: a simulation may spawn processes of its own,
    which killing the parent alone would leave running (Windows has no process groups)."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
    else:
        os.killpg(process.pid, signal.SIGKILL)  # the child leads its own session (start_new_session)


def _clip(text: str, folder: Path) -> str:
    """Hide the temporary folder from paths, and keep the output to a readable size."""
    text = text.replace(str(folder) + os.sep, "").replace(str(folder), ".")
    return text if len(text) <= MAX_OUTPUT else text[:MAX_OUTPUT] + "\n… (sortie tronquée)"


class SimulationRunner:
    def __init__(self, corpus: CorpusService, python: str = sys.executable):
        self.corpus = corpus
        self.python = python
        self._slots = threading.BoundedSemaphore(PARALLEL_RUNS)

    def run(self, code: str, timeout: float = DEFAULT_TIMEOUT) -> RunResult:
        bricks = self.corpus.brick_sources()
        products = self.corpus.products()
        with self._slots, tempfile.TemporaryDirectory(prefix="prep-frm-run-") as tmp:
            folder = Path(tmp)
            self._prepare(folder, code, bricks, products)
            started = time.perf_counter()
            try:
                process = subprocess.Popen(
                    [self.python, "-I", "-X", "utf8", "_runner.py"],
                    cwd=folder,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=child_env(),
                    # Own process group/session, so that a timeout kills the whole tree.
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                    start_new_session=os.name != "nt",
                )
            except OSError as error:
                raise SimulationRunnerError(str(error)) from error
            try:
                stdout, stderr = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                kill_tree(process)
                stdout, stderr = process.communicate()
                return RunResult(
                    ok=False,
                    stdout=_clip(stdout.decode("utf-8", "replace"), folder),
                    stderr=_clip(stderr.decode("utf-8", "replace"), folder),
                    duration_ms=int(timeout * 1000),
                    timed_out=True,
                    error={"type": "Timeout", "message": f"Arrêté au bout de {timeout:g} s", "line": None},
                    bricks=used_bricks(code, bricks),
                )
            duration = int((time.perf_counter() - started) * 1000)
            completed = subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
            return self._result(folder, completed, duration, used_bricks(code, bricks))

    @staticmethod
    def _prepare(folder: Path, code: str, bricks, products: dict | None = None) -> None:
        try:
            (folder / "main.py").write_text(code, encoding="utf-8")
            (folder / "_runner.py").write_text(RUNNER, encoding="utf-8")
            (folder / "produits.py").write_text(PRODUCTS_MODULE.format(products=repr(products or {})), encoding="utf-8")
            package = folder / "briques"
            package.mkdir()
            (package / "__init__.py").write_text("", encoding="utf-8")
            for brick in bricks:
                (package / f"{brick.module}.py").write_text(brick.code, encoding="utf-8")
        except OSError as error:
            raise SimulationRunnerError(f"préparation impossible : {error}") from error

    @staticmethod
    def _result(folder: Path, process: subprocess.CompletedProcess, duration: int, used: list[UsedBrick]) -> RunResult:
        stdout = _clip(process.stdout.decode("utf-8", "replace"), folder)
        stderr = _clip(process.stderr.decode("utf-8", "replace"), folder)
        result_path = folder / "_result.json"
        if not result_path.exists():  # the process died before the runner could report
            error = {"type": "ProcessError", "message": f"Le processus s'est arrêté (code {process.returncode})", "line": None}
            return RunResult(False, stdout, stderr, duration, error=error, bricks=used)
        report = json.loads(result_path.read_text(encoding="utf-8"))
        figures = [
            "data:image/png;base64," + base64.b64encode((folder / name).read_bytes()).decode("ascii")
            for name in report["figures"]
        ]
        return RunResult(report["error"] is None, stdout, stderr, duration, error=report["error"], figures=figures, bricks=used)


# Module importable by the code run (and by the bricks): the financial products of the corpus.
PRODUCTS_MODULE = """\"\"\"Financial products of the corpus, generated for this run.

produit("id") gives a new object whose attributes are the variables declared on the product's page,
all None: the code fills them (p.fixed_rate = 0.03). Assigning a name the product does not declare
raises an error (a typo would otherwise go unnoticed).\"\"\"

PRODUITS = {products}


class Produit:
    \"\"\"One financial product of the corpus: its declared variables, to fill.\"\"\"

    def __init__(self, identifiant, notes):
        object.__setattr__(self, "_id", identifiant)
        object.__setattr__(self, "_notes", dict(notes))
        for nom in notes:
            object.__setattr__(self, nom, None)

    def __setattr__(self, nom, valeur):
        if nom not in self._notes:
            declarees = ", ".join(self._notes) or "aucune"
            raise AttributeError(
                f"« {{nom}} » n'est pas une variable du produit {{self._id!r}} (variables : {{declarees}}). "
                "Ajoute-la sur la page du produit dans le corpus."
            )
        object.__setattr__(self, nom, valeur)

    def variables(self):
        \"\"\"{{name: value}} of the declared variables (None until filled).\"\"\"
        return {{nom: getattr(self, nom) for nom in self._notes}}

    def a_remplir(self):
        \"\"\"Names of the declared variables still None.\"\"\"
        return [nom for nom, valeur in self.variables().items() if valeur is None]

    def notes(self):
        \"\"\"{{name: note}} as written on the product's page.\"\"\"
        return dict(self._notes)

    def __repr__(self):
        valeurs = ", ".join(f"{{nom}}={{valeur!r}}" for nom, valeur in self.variables().items())
        return f"produit({{self._id!r}}: {{valeurs}})"


def produit(identifiant):
    \"\"\"A new object for the product `identifiant` (its corpus identifier, e.g. "obligation-5-ans").\"\"\"
    if identifiant not in PRODUITS:
        connus = ", ".join(sorted(PRODUITS)) or "aucun"
        raise KeyError(f"Produit inconnu du corpus : {{identifiant!r}} (produits : {{connus}})")
    return Produit(identifiant, PRODUITS[identifiant])
"""
