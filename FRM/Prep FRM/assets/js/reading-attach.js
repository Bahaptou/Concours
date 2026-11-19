/* Attaching corpus entries to readings by hand (choice of Baptiste, 2026-11-19): the readings picker
 * and the call to the server, shared by the Corpus page (one entry or a selection), the Reading page
 * and the entry editor. A classic script, loaded where it is needed; writing needs the server, the
 * pages that call it only offer it over http.
 *
 *   FRM.readingAttach.pick({ title, entries, onApply })  opens the picker
 *   FRM.readingAttach.change(ids, add, remove)           POST /api/corpus/readings, then updates the
 *                                                        corpus the page holds
 */
(function (FRM, ui) {
  "use strict";

  const { esc, fold } = ui;
  let dialog = null;

  /** Attaches (`add`) and detaches (`remove`) readings on the entries `ids`, in one request. */
  async function change(ids, add, remove) {
    const response = await fetch("/api/corpus/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: ids, add, remove }),
    }).catch(() => {
      throw new Error("Serveur injoignable : relance « Lancer Prep FRM.bat ».");
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error((payload && (payload.detail || payload.title)) || `Erreur ${response.status}`);
    FRM.mergeCorpusEntries(payload.data.entries);
    return payload.data.entries;
  }

  /** "all" | "some" | "none": how many of the entries have the reading attached by hand. */
  function stateOf(entries, readingId) {
    const count = entries.filter((entry) => (entry.directReadings || []).includes(readingId)).length;
    return count === 0 ? "none" : count === entries.length ? "all" : "some";
  }

  function build() {
    dialog = Object.assign(document.createElement("dialog"), { className: "profile-dialog reading-dialog" });
    dialog.innerHTML = `
<form method="dialog">
  <h2 data-title></h2>
  <p class="small muted" data-intro></p>
  <input type="search" class="search" data-reading-search placeholder="Chercher : numéro, tag (QA-3) ou titre…" aria-label="Chercher un reading" autocomplete="off">
  <div class="reading-choices" data-choices></div>
  <div class="dialog-actions">
    <span class="small muted" data-summary></span>
    <button type="button" class="btn ghost" data-dialog-cancel>Annuler</button>
    <button type="submit" class="btn" value="apply" data-apply>Appliquer</button>
  </div>
</form>`;
    dialog.querySelector("[data-dialog-cancel]").addEventListener("click", () => dialog.close());
    document.body.appendChild(dialog);
  }

  /**
   * Opens the picker on `entries` (objects with `directReadings`). A reading is checked when every
   * entry has it, half-checked ("some") when only some do. Clicking a reading checks it for all or
   * clears it for all; a half-checked one left alone stays as it is. `onApply(add, remove)` (async)
   * runs once on Appliquer, with only what changed; nothing is called when nothing changed.
   */
  function pick({ title, entries, onApply }) {
    if (!dialog) build();
    const initial = new Map(FRM.readings.map((reading) => [reading.id, stateOf(entries, reading.id)]));
    const current = new Map(initial);
    const many = entries.length > 1;
    const choices = dialog.querySelector("[data-choices]");
    const search = dialog.querySelector("[data-reading-search]");
    dialog.querySelector("[data-title]").textContent = title;
    dialog.querySelector("[data-intro]").textContent = many
      ? `${entries.length} entrées. Un reading coché les rattache toutes, décoché les détache toutes ; à moitié coché : seulement certaines l'ont, rien ne change tant qu'on n'y touche pas.`
      : "Les readings saisis ici s'ajoutent à ceux des fiches qui citent l'entrée et des questions qui lui sont liées.";

    const changes = () => ({
      add: [...current].filter(([id, state]) => state === "all" && initial.get(id) !== "all").map(([id]) => id),
      remove: [...current].filter(([id, state]) => state === "none" && initial.get(id) !== "none").map(([id]) => id),
    });

    function summarize() {
      const { add, remove } = changes();
      const parts = [add.length && `+${add.length}`, remove.length && `−${remove.length}`].filter(Boolean);
      dialog.querySelector("[data-summary]").textContent = parts.join(" · ");
      dialog.querySelector("[data-apply]").disabled = !parts.length;
    }

    function render() {
      const query = fold(search.value.trim());
      const matches = (reading) => !query || fold(`${reading.id} ${reading.tag} ${reading.title}`).includes(query);
      choices.innerHTML =
        FRM.books
          .map((book) => {
            const rows = book.readings.filter(matches).map((reading) => {
              const state = current.get(reading.id);
              return `<label class="reading-choice"><input type="checkbox" data-reading="${reading.id}"${state === "all" ? " checked" : ""}> <span class="rtag">${esc(reading.tag)}</span> <span class="rtitle">${esc(reading.title)}</span>${state === "some" ? ` <span class="rsome">${stateOfCount(reading.id)}</span>` : ""}</label>`;
            });
            return rows.length ? `<h3>Livre ${book.id} · ${esc(ui.shortTitle(book))}</h3>${rows.join("")}` : "";
          })
          .join("") || `<p class="small muted">Aucun reading ne correspond.</p>`;
      // A checkbox has no half state in HTML: set it from the script.
      choices.querySelectorAll("input[data-reading]").forEach((box) => (box.indeterminate = current.get(Number(box.dataset.reading)) === "some"));
      summarize();
    }

    /** "2/5": how many of the entries have the reading, shown on a half-checked one. */
    const stateOfCount = (readingId) => `${entries.filter((e) => (e.directReadings || []).includes(readingId)).length}/${entries.length}`;

    choices.onchange = (event) => {
      const box = event.target.closest("input[data-reading]");
      if (!box) return;
      current.set(Number(box.dataset.reading), box.checked ? "all" : "none");
      render();
    };
    // A half-checked box is unchecked underneath: a click checks it, which attaches the reading to all.
    search.oninput = render;
    search.onkeydown = (event) => event.key === "Enter" && event.preventDefault();
    search.value = "";
    render();

    dialog.onclose = async () => {
      if (dialog.returnValue !== "apply") return;
      const { add, remove } = changes();
      if (!add.length && !remove.length) return;
      try {
        await onApply(add, remove);
      } catch (error) {
        ui.flash(error.message, "error");
      }
    };
    dialog.returnValue = "";
    dialog.showModal();
    search.focus();
  }

  FRM.readingAttach = { pick, change };
})(window.FRM, window.FRM.ui);
