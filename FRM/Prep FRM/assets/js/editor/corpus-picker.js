// "Corpus" menu of the editors: search an entry, then cite it ([[id]]) or insert it (![[id]]),
// the links Obsidian understands.
const { FRM } = window;
const { ui } = FRM;
const { esc, typeTag } = ui;

/** Moves the cursor below the YAML header (--- … ---) when it is in it: text written there would
 *  break the header, for the site and for Obsidian. */
export function keepCursorBelowHeader(view) {
  const { doc, selection } = view.state;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return;
  let end = null;
  for (let number = 2; number <= doc.lines; number += 1) {
    if (doc.line(number).text.trim() === "---") {
      end = doc.line(number);
      break;
    }
  }
  if (!end || selection.main.head > end.to) return;
  if (end.number < doc.lines) {
    view.dispatch({ selection: { anchor: doc.line(end.number + 1).from } });
  } else {
    view.dispatch({ changes: { from: end.to, insert: "\n" }, selection: { anchor: end.to + 1 } });
  }
}

/**
 * Builds the menu: a toolbar button and its floating panel, with the corpus search bar
 * (corpus-search.js: types, books, authors, reading, attachment, linked entries, text). The
 * filters stay as set between two openings.
 *
 * view: the editor the actions write into, or a function returning it (editors with several fields);
 * load: async () => entries ({ id, type, titre, readings, journal, cites, imports }), called at
 *       each opening so that an entry created in another tab shows up;
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
  <div data-picker-search></div>
  <ul class="picker-list"></ul>
  <div class="picker-foot"><span data-picker-status></span><a href="entree.html" target="_blank" rel="noopener">+ Nouvelle entrée ↗</a></div>
</div>`;
  const target = typeof view === "function" ? view : () => view;
  const button = root.querySelector("button");
  const panel = root.querySelector(".picker-panel");
  const list = root.querySelector(".picker-list");
  const status = root.querySelector("[data-picker-status]");
  let entries = [];
  const bar = FRM.corpusSearch.create(root.querySelector("[data-picker-search]"), { onChange: render, offer: (entry) => entry.id !== exclude() });
  const { search } = bar;

  function render() {
    const { offered, shown, linked } = bar.results();
    list.innerHTML =
      [...shown.map((entry) => ({ entry, via: null })), ...linked]
        .map(({ entry, via }) => {
          const tags = entry.readings.map(FRM.findReading).filter(Boolean).map((reading) => reading.tag).join(", ");
          const line = [tags, via ? FRM.linkedLabel(via, entries) : ""].filter(Boolean).join(" · ");
          return `
<li class="picker-item${via ? " is-linked" : ""}">
  ${typeTag(entry.type)}
  <span class="ptitle">${esc(entry.titre)} <span class="entry-id">${esc(entry.id)}</span>${line ? `<span class="preadings">${esc(line)}</span>` : ""}</span>
  ${actions.map((action, i) => `<button type="button" class="tool" data-action="${i}" data-id="${esc(entry.id)}" title="${esc(action.title)}">${esc(typeof action.label === "function" ? action.label(entry) : action.label)}</button>`).join("")}
</li>`;
        })
        .join("") || `<li class="picker-item muted">${offered.length ? "Aucune entrée ne correspond à ces filtres." : "Le corpus est vide."}</li>`;
    status.textContent = `${shown.length}${linked.length ? ` + ${linked.length} liée${linked.length > 1 ? "s" : ""}` : ""} / ${offered.length}`;
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
      bar.setEntries(entries);
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
      bar.setEntries(entries);
      render();
    }
  }

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
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
    // The path as dispatched: a filter button re-rendered by its own click is no longer in `root`.
    if (!event.composedPath().includes(root)) close();
  });
  return root;
}
