// "Corpus" menu of the editors: search an entry, then cite it (#voir) or insert it (#entree).
// The needed #import line is added at the top of the source when missing, so the pote never
// has to know about it.
const { FRM } = window;
const { esc, fold, typeTag } = FRM.ui;

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
  keepCursorBelowImports(view);
}

function keepCursorBelowImports(view) {
  const { doc, selection } = view.state;
  const last = lastImportLine(doc);
  if (!last || selection.main.head > last.to) return;
  if (last.number < doc.lines) {
    view.dispatch({ selection: { anchor: doc.line(last.number + 1).from } });
  } else {
    view.dispatch({ changes: { from: last.to, insert: "\n" }, selection: { anchor: last.to + 1 } });
  }
}

/**
 * Builds the menu: a toolbar button and its floating panel.
 *
 * load: async () => entries ({ id, type, titre }), called at each opening so that an entry
 *       created in another tab shows up;
 * actions: [{ label, title, run(view, entry) }], one button per action on each entry;
 * exclude: () => id of an entry not to offer (the one being edited), or null;
 * label, title: the toolbar button (the corpus by default; "Briques" for the Python pane).
 */
export function corpusPicker(view, { load, actions, exclude = () => null, label = "📚 Corpus", title = "Citer ou insérer une entrée du corpus" }) {
  const root = Object.assign(document.createElement("div"), { className: "picker" });
  root.innerHTML = `
<button type="button" class="tool" aria-expanded="false" title="${esc(title)}">${esc(label)}</button>
<div class="picker-panel" hidden>
  <input type="search" class="search" placeholder="Chercher : titre ou identifiant…" aria-label="Chercher dans le corpus">
  <ul class="picker-list"></ul>
  <div class="picker-foot"><span data-picker-status></span><a href="entree.html" target="_blank" rel="noopener">+ Nouvelle entrée ↗</a></div>
</div>`;
  const button = root.querySelector("button");
  const panel = root.querySelector(".picker-panel");
  const search = root.querySelector("input");
  const list = root.querySelector(".picker-list");
  const status = root.querySelector("[data-picker-status]");
  let entries = [];

  function render() {
    const query = fold(search.value.trim());
    const excluded = exclude();
    const shown = entries.filter((entry) => entry.id !== excluded && (!query || fold(`${entry.titre} ${entry.id}`).includes(query)));
    list.innerHTML =
      shown
        .map(
          (entry) => `
<li class="picker-item">
  ${typeTag(entry.type)}
  <span class="ptitle">${esc(entry.titre)} <span class="entry-id">${esc(entry.id)}</span></span>
  ${actions.map((action, i) => `<button type="button" class="tool" data-action="${i}" data-id="${esc(entry.id)}" title="${esc(action.title)}">${esc(action.label)}</button>`).join("")}
</li>`
        )
        .join("") || `<li class="picker-item muted">${entries.length ? "Aucune entrée ne correspond." : "Le corpus est vide."}</li>`;
    status.textContent = `${shown.length} / ${entries.length}`;
  }

  async function open() {
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    search.focus();
    status.textContent = "Chargement…";
    try {
      entries = await load();
      render();
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
    }
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function run(index, id) {
    const entry = entries.find((e) => e.id === id);
    close();
    if (entry) actions[index].run(view, entry);
  }

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      view.focus();
    }
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
