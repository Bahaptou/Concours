/* Running Python code (simulations and bricks of the corpus): the run panel, and the single
 * place that knows how code is executed. Today the local server runs it (POST /api/run);
 * another engine (e.g. Pyodide in the browser) would only replace `execute` below.
 *
 * A successful run ticks step ③ of the readings of the simulation (those of the notes using it). */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const { store } = FRM;
  const SETTINGS_KEY = "frm-part1.runner.v1";
  const DEFAULT_TIMEOUT = 30;
  const MAX_TIMEOUT = 300; // same bounds as the server (backend/simulations.py)

  const available = () => location.protocol.startsWith("http");

  // ------------------------------------------------------------------ settings (this browser only)

  function timeoutSetting() {
    try {
      const value = Number(JSON.parse(localStorage.getItem(SETTINGS_KEY))?.timeout);
      return value >= 1 && value <= MAX_TIMEOUT ? value : DEFAULT_TIMEOUT;
    } catch (e) {
      return DEFAULT_TIMEOUT;
    }
  }

  function saveTimeout(value) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timeout: value }));
    } catch (e) {
      /* storage unavailable: the value holds for this page */
    }
  }

  // ------------------------------------------------------------------ engine

  /** Runs code; `author` picks which version of each brick is imported. Resolves to the result
   *  ({ ok, stdout, stderr, error, figures, durationMs, timedOut, bricks }), rejects with an Error. */
  async function execute(code, author, timeout) {
    let response;
    try {
      response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, author, timeout }),
      });
    } catch (e) {
      throw new Error("Serveur injoignable : relance « Lancer Prep FRM.bat ».");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error((payload && payload.detail) || `Erreur ${response.status}`);
    return payload.data;
  }

  // ------------------------------------------------------------------ panel

  function renderResult(box, result, readings) {
    const status = result.ok
      ? `<span class="run-ok">✓ Terminé en ${ui.number(result.durationMs / 1000, 1)} s</span>`
      : result.timedOut
        ? `<span class="run-ko">⏱ ${esc(result.error.message)} : augmente la limite ou allège le calcul.</span>`
        : `<span class="run-ko">✗ ${esc(result.error.type)}${result.error.line ? `, ligne ${result.error.line}` : ""} : ${esc(result.error.message)}</span>`;
    const bricks = result.bricks.length
      ? `<div class="small muted">Briques : ${result.bricks.map((b) => `${esc(b.module)} (version de ${esc(b.author)})`).join(", ")}</div>`
      : "";
    const stdout = result.stdout ? `<pre class="run-out">${esc(result.stdout)}</pre>` : "";
    const stderr = result.stderr ? `<pre class="run-out run-err">${esc(result.stderr)}</pre>` : "";
    const figures = result.figures.map((src, i) => `<img class="run-figure" src="${src}" alt="Figure ${i + 1}">`).join("");
    const ticked = result.ok && readings.length
      ? `<div class="small muted">Étape ③ cochée : ${readings.map((r) => esc(FRM.findReading(r)?.tag || `R${r}`)).join(", ")}.</div>`
      : "";
    box.innerHTML = `<div class="run-status">${status}</div>${bricks}${stdout}${stderr}${figures ? `<div class="run-figures">${figures}</div>` : ""}${ticked}`;
  }

  /**
   * Run panel under a piece of code. Options:
   *   code: () => string (read at each click: the editor's current text, or a stored version);
   *   author: slug picking the bricks' versions (the version's author, or the current profile);
   *   readings: () => [reading ids] whose step ③ a success ticks.
   * Returns the panel element. Without the server, a hint replaces the button.
   */
  function panel({ code, author, readings = () => [] }) {
    const root = Object.assign(document.createElement("div"), { className: "run-panel" });
    if (!available()) {
      root.innerHTML = `<span class="small muted">Pour exécuter ce code, lance <code>Lancer Prep FRM.bat</code>.</span>`;
      return root;
    }
    root.innerHTML = `
<div class="run-bar">
  <button type="button" class="btn" data-run>▶ Exécuter</button>
  <label class="small muted">Limite <input type="number" class="run-timeout" min="1" max="${MAX_TIMEOUT}" step="1" value="${timeoutSetting()}"> s</label>
</div>
<div class="run-result" aria-live="polite"></div>`;
    const button = root.querySelector("[data-run]");
    const input = root.querySelector(".run-timeout");
    const box = root.querySelector(".run-result");
    input.addEventListener("change", () => {
      const value = Math.min(MAX_TIMEOUT, Math.max(1, Math.round(Number(input.value) || DEFAULT_TIMEOUT)));
      input.value = value;
      saveTimeout(value);
    });
    button.addEventListener("click", async () => {
      button.disabled = true;
      box.innerHTML = `<div class="run-status muted">Exécution…</div>`;
      try {
        const result = await execute(code(), author, Number(input.value) || DEFAULT_TIMEOUT);
        const ids = result.ok ? readings() : [];
        ids.forEach((id) => store.progress.set(id, "simulation", true));
        renderResult(box, result, ids);
        if (ids.length) ui.refresh();
      } catch (error) {
        box.innerHTML = `<div class="run-status"><span class="run-ko">⚠ ${esc(error.message)}</span></div>`;
      } finally {
        button.disabled = false;
      }
    });
    return root;
  }

  /** Puts a run panel in every `[data-run-entry][data-run-author]` slot of `container`: the stored
   *  version of that corpus entry, run with that author's bricks, ticking the entry's readings. */
  function mountSlots(container) {
    container.querySelectorAll("[data-run-entry][data-run-author]").forEach((slot) => {
      const entry = FRM.findEntry(slot.dataset.runEntry);
      const version = entry && entry.versions.find((v) => v.author === slot.dataset.runAuthor);
      if (!version || !version.code) return;
      slot.replaceChildren(panel({ code: () => version.code, author: version.author, readings: () => entry.readings }));
    });
  }

  /** The slot to leave in a page's HTML for `mountSlots`. */
  const slot = (entry, version) => `<div data-run-entry="${esc(entry.id)}" data-run-author="${esc(version.author)}"></div>`;

  FRM.runner = { available, execute, panel, mountSlots, slot };
})(window.FRM, window.FRM.ui);
