// "Corpus" menu of the editors: search an entry, then cite it (#voir) or insert it (#entree).
// The needed #import line is added at the top of the source when missing, so the pote never
// has to know about it.
const { FRM } = window;
const { ui } = FRM;
const { esc, fold, typeTag } = ui;
const NO_READING = "none"; // book filter: entries no note uses yet

const IMPORT_LINE = /^#import\s+"([^"]+)"\s*(?::\s*(.*))?$/;

/** Last #import line of the source, or null. */
function lastImportLine(doc) {
  let last = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (IMPORT_LINE.test(line.text.trim())) last = line;
  }
  return last;
}

/** Makes sure the source imports `names` from `path`: completes the #import line, or adds one
 *  after the last import (first line when there is none). Then moves the cursor below the
 *  imports if needed: Typst rejects a name used before its import. */
export function ensureImport(view, path, names) {
  const { doc } = view.state;
  let found = false;
  for (let number = 1; number <= doc.lines && !found; number += 1) {
    const line = doc.line(number);
    const match = IMPORT_LINE.exec(line.text.trim());
    if (!match || match[1] !== path) continue;
    found = true;
    const imported = (match[2] || "").split(",").map((name) => name.trim()).filter(Boolean);
    const missing = names.filter((name) => !imported.includes(name));
    if (!imported.includes("*") && missing.length) {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: `#import "${path}": ${[...imported, ...missing].join(", ")}` } });
    }
  }
  if (!found) {
    const text = `#import "${path}": ${names.join(", ")}`;
    const last = lastImportLine(doc);
    view.dispatch({ changes: last ? { from: last.to, insert: `\n${text}` } : { from: 0, insert: `${text}\n` } });
  }
  keepCursorBelowHeader(view);
}

/** Last line of the header: the leading #import lines and #show rules (a multi-line
 *  `#show: fiche.with(…)` ends at its closing parenthesis), comments and blank lines allowed. */
function headerEnd(doc) {
  let end = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    const text = doc.line(number).text.trim();
    if (IMPORT_LINE.test(text)) {
      end = doc.line(number);
    } else if (text.startsWith("#show")) {
      let depth = 0;
      for (; number <= doc.lines; number += 1) {
        for (const char of doc.line(number).text) depth += char === "(" ? 1 : char === ")" ? -1 : 0;
        if (depth <= 0) break;
      }
      end = doc.line(Math.min(number, doc.lines));
    } else if (text && !text.startsWith("//")) {
      break; // first real content
    }
  }
  return end;
}

/** Moves the cursor below the header when it is in or above it: Typst rejects a name used
 *  before its import, and content placed before `#show: fiche.with(…)` escapes the note's
 *  layout (it would make a page of its own). */
export function keepCursorBelowHeader(view) {
  const { doc, selection } = view.state;
  const last = headerEnd(doc);
  if (!last || selection.main.head > last.to) return;
  if (last.number < doc.lines) {
    view.dispatch({ selection: { anchor: doc.line(last.number + 1).from } });
  } else {
    view.dispatch({ changes: { from: last.to, insert: "\n" }, selection: { anchor: last.to + 1 } });
  }
}

/**
 * Builds the menu: a toolbar button and its floating panel, with the filters of the corpus page
 * (type, book or "no reading", reading, author) above the search. The filters stay as set
 * between two openings; a filter with a single possible value is not shown (the bricks menu).
 *
 * view: the editor the actions write into, or a function returning it (editors with several fields);
 * load: async () => entries ({ id, type, titre, readings, versions }), called at each opening so
 *       that an entry created in another tab shows up;
 * actions: [{ label, title, run(view, entry) }], one button per action on each entry; label may be
 *          a function of the entry ("Lier" / "Délier"), run may be async;
 * keepOpen: true to stay open after an action (entries reloaded), false to close (insertions);
 * exclude: () => id of an entry not to offer (the one being edited), or null;
 * label, title: the toolbar button (the corpus by default; "Briques" for the Python pane).
 */
export function corpusPicker(view, { load, actions, exclude = () => null, keepOpen = false, label = "📚 Corpus", title = "Citer ou insérer une entrée du corpus" }) {
  const root = Object.assign(document.createElement("div"), { className: "picker" });
  root.innerHTML = `
<button type="button" class="tool" aria-expanded="false" title="${esc(title)}">${esc(label)}</button>
<div class="picker-panel corpus-panel" hidden>
  <div class="picker-filters" data-picker-filters></div>
  <input type="search" class="search" placeholder="Chercher : titre ou identifiant…" aria-label="Chercher dans le corpus">
  <ul class="picker-list"></ul>
  <div class="picker-foot"><span data-picker-status></span><a href="entree.html" target="_blank" rel="noopener">+ Nouvelle entrée ↗</a></div>
</div>`;
  const target = typeof view === "function" ? view : () => view;
  const button = root.querySelector("button");
  const panel = root.querySelector(".picker-panel");
  const filterBox = root.querySelector("[data-picker-filters]");
  const search = root.querySelector("input");
  const list = root.querySelector(".picker-list");
  const status = root.querySelector("[data-picker-status]");
  let entries = [];
  const filters = { type: "all", book: "all", reading: "all", author: "all" };

  const offered = () => entries.filter((entry) => entry.id !== exclude());
  const booksOf = (entry) => new Set(entry.readings.map(FRM.findReading).filter(Boolean).map((reading) => FRM.bookOf(reading).id));

  function matches(entry, query) {
    return (
      (filters.type === "all" || entry.type === filters.type) &&
      (filters.book === "all" || (filters.book === NO_READING ? !entry.readings.length : booksOf(entry).has(Number(filters.book)))) &&
      (filters.reading === "all" || entry.readings.includes(Number(filters.reading))) &&
      (filters.author === "all" || entry.versions.some((version) => version.author === filters.author)) &&
      (!query || fold(`${entry.titre} ${entry.id}`).includes(query))
    );
  }

  /** Type toggles (with counts) and three selects; built from what was loaded. */
  function renderFilters() {
    const pool = offered();
    const count = (fn) => pool.filter(fn).length;
    const types = FRM.ENTRY_TYPES.filter((type) => pool.some((entry) => entry.type === type.id));
    if (!types.some((type) => type.id === filters.type)) filters.type = "all";
    const toggle = (value, text, extra = "") =>
      `<button type="button" class="toggle small${extra}" data-picker-type="${value}" aria-pressed="${filters.type === value}">${esc(text)}</button>`;
    const typeRow = types.length > 1
      ? `<div class="filter-group">${toggle("all", `Tous (${pool.length})`)}${types.map((type) => toggle(type.id, `${type.plural} (${count((e) => e.type === type.id)})`, ` etype-filter etype-${type.id}`)).join("")}</div>`
      : "";
    const option = (value, text, current) => `<option value="${esc(String(value))}"${String(current) === String(value) ? " selected" : ""}>${esc(text)}</option>`;
    const books = FRM.books.filter((book) => pool.some((entry) => booksOf(entry).has(book.id)));
    const withoutReading = count((entry) => !entry.readings.length);
    const readings = FRM.books.flatMap((book) => book.readings).filter((reading) => pool.some((entry) => entry.readings.includes(reading.id)));
    const authors = new Map();
    pool.forEach((entry) => entry.versions.forEach((version) => authors.set(version.author, version.name)));
    const select = (name, label, options) => `<select class="picker-select" data-picker-select="${name}" aria-label="${label}">${options.join("")}</select>`;
    const selects = [
      books.length + (withoutReading ? 1 : 0) > 1
        ? select("book", "Livre", [
            option("all", "Tous les livres", filters.book),
            ...books.map((book) => option(book.id, `Livre ${book.id} · ${ui.shortTitle(book)}`, filters.book)),
            ...(withoutReading ? [option(NO_READING, `Sans reading (${withoutReading})`, filters.book)] : []),
          ])
        : "",
      readings.length > 1
        ? select("reading", "Reading", [option("all", "Tous les readings", filters.reading), ...readings.map((reading) => option(reading.id, `${reading.tag} · ${reading.title}`, filters.reading))])
        : "",
      authors.size > 1
        ? select("author", "Auteur", [option("all", "Tous les auteurs", filters.author), ...[...authors].sort((a, b) => a[1].localeCompare(b[1], "fr")).map(([slug, name]) => option(slug, name, filters.author))])
        : "",
    ].join("");
    filterBox.innerHTML = `${typeRow}${selects ? `<div class="filter-group">${selects}</div>` : ""}`;
    filterBox.hidden = !typeRow && !selects;
  }

  function render() {
    const query = fold(search.value.trim());
    const pool = offered();
    const shown = pool.filter((entry) => matches(entry, query));
    list.innerHTML =
      shown
        .map((entry) => {
          const tags = entry.readings.map(FRM.findReading).filter(Boolean).map((reading) => reading.tag).join(", ");
          return `
<li class="picker-item">
  ${typeTag(entry.type)}
  <span class="ptitle">${esc(entry.titre)} <span class="entry-id">${esc(entry.id)}</span>${tags ? `<span class="preadings">${esc(tags)}</span>` : ""}</span>
  ${actions.map((action, i) => `<button type="button" class="tool" data-action="${i}" data-id="${esc(entry.id)}" title="${esc(action.title)}">${esc(typeof action.label === "function" ? action.label(entry) : action.label)}</button>`).join("")}
</li>`;
        })
        .join("") || `<li class="picker-item muted">${pool.length ? "Aucune entrée ne correspond à ces filtres." : "Le corpus est vide."}</li>`;
    status.textContent = `${shown.length} / ${pool.length}`;
  }

  async function open() {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    // The panel is wide: shift it left when the button sits too far right for it to fit.
    panel.style.left = "0px";
    const overflow = panel.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
    if (overflow > 0) panel.style.left = `${-overflow}px`;
    search.focus();
    status.textContent = "Chargement…";
    try {
      entries = await load();
      renderFilters();
      render();
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
    }
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  async function run(index, id) {
    const entry = entries.find((e) => e.id === id);
    if (!keepOpen) close();
    if (!entry) return;
    try {
      await actions[index].run(target(), entry);
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
      return;
    }
    if (keepOpen) {
      // Several actions in a row (link a question to several entries): reload to show the new state.
      entries = await load();
      renderFilters();
      render();
    }
  }

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  search.addEventListener("input", render);
  filterBox.addEventListener("mousedown", (event) => event.target.closest("button") && event.preventDefault());
  filterBox.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-picker-type]");
    if (!toggle) return;
    filters.type = toggle.dataset.pickerType;
    filterBox.querySelectorAll("[data-picker-type]").forEach((b) => b.setAttribute("aria-pressed", String(b === toggle)));
    render();
  });
  filterBox.addEventListener("change", (event) => {
    const select = event.target.closest("[data-picker-select]");
    if (!select) return;
    filters[select.dataset.pickerSelect] = select.value;
    render();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      target()?.focus(); // no editor when the menu links a question
    }
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      // Enter runs the first action on the first result: fast path for the keyboard.
      const first = list.querySelector("[data-action]");
      if (first) run(Number(first.dataset.action), first.dataset.id);
    }
  });
  list.addEventListener("mousedown", (event) => event.preventDefault()); // keep the editor's selection
  list.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (action) run(Number(action.dataset.action), action.dataset.id);
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) close();
  });
  return root;
}
