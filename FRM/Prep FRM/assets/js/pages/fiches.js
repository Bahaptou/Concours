/* Notes portal (fiches.html): every reading in the official order, with its steps, its notes
 * and the corpus entries they cite or insert. Filters: books, authors and entry types
 * (multi-select, FRM.toggleChoice), note state, chapter (search) and corpus entry (search);
 * four step pins sort by a ticked step.
 * A click opens the reading page on its notes card.
 * Data: notes/index.js (notes by reading and author) and notes/corpus/index.js (entries and
 * the notes using them), both written by the server and readable without it. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const { store } = FRM;
  const LAST_STEP = FRM.STEPS[FRM.STEPS.length - 1].id; // ④, the note

  // books, authors, entryTypes: multi-select, null (everything) or a Set of strings (FRM.toggleChoice).
  const filters = { books: null, state: "all", authors: null, entryTypes: null, chapter: "", query: "" };
  // Step pin: sort by one step, ticked first ("done") or unticked first ("todo"); null = official order.
  let pin = null;

  // ------------------------------------------------------------------ data

  const capitalized = (slug) => slug.charAt(0).toUpperCase() + slug.slice(1);
  const notesHref = (reading, author) => `reading.html?id=${reading.id}${author ? `&auteur=${encodeURIComponent(author)}` : ""}#notes-card`;

  /** {reading id: [{ entry, authors: [slug] }]}: the corpus entries each reading's notes use. */
  function entriesByReading() {
    const byReading = new Map();
    for (const entry of FRM.corpusEntries()) {
      for (const use of entry.usedBy || []) {
        const list = byReading.get(use.reading) || [];
        const found = list.find((item) => item.entry === entry);
        if (found) found.authors.push(use.author);
        else list.push({ entry, authors: [use.author] });
        byReading.set(use.reading, list);
      }
    }
    return byReading;
  }

  // ------------------------------------------------------------------ filters

  const STATES = [
    { value: "all", label: "Tous les readings" },
    { value: "with", label: "Avec fiche", test: (r, notes) => notes.length > 0 },
    { value: "without", label: "Sans fiche", test: (r, notes) => notes.length === 0 },
    { value: "unchecked", label: "Fiche écrite, ④ non cochée", test: (r, notes) => notes.length > 0 && !store.progress.isDone(r.id, LAST_STEP) },
    { value: "missing", label: "④ cochée sans fiche", test: (r, notes) => notes.length === 0 && store.progress.isDone(r.id, LAST_STEP) },
  ];

  function matches(reading, notes, used) {
    if (!FRM.isChosen(filters.books, FRM.bookOf(reading).id)) return false;
    if (!matchesChapter(reading)) return false;
    const state = STATES.find((s) => s.value === filters.state);
    if (state.test && !state.test(reading, notes)) return false;
    if (filters.authors !== null && !notes.some((author) => filters.authors.has(author))) return false;
    return matchingEntries(used).length > 0 || (filters.entryTypes === null && !filters.query.trim());
  }

  /** "10" finds chapter 10 of every book (FRM-10, QA-10…); text searches the reference and title. */
  function matchesChapter(reading) {
    const query = filters.chapter.trim();
    if (!query) return true;
    if (/^\d+$/.test(query)) return reading.chapter === Number(query);
    return ui.fold(`${reading.tag} ${reading.title}`).includes(ui.fold(query));
  }

  /** The used entries that satisfy the entry filters (type and search). */
  function matchingEntries(used) {
    const query = ui.fold(filters.query.trim());
    return used.filter(
      ({ entry }) =>
        FRM.isChosen(filters.entryTypes, entry.type) &&
        (!query || ui.fold(`${entry.titre} ${entry.id}`).includes(query))
    );
  }

  function toggles(key, options) {
    return options
      .map((o) => `<button type="button" class="toggle${o.className || ""}" data-filter="${key}" data-value="${esc(String(o.value))}" aria-pressed="${filters[key] === o.value}"${o.title ? ` title="${esc(o.title)}"` : ""}>${esc(o.label)}</button>`)
      .join("");
  }

  /** Four pins, one per step: a click sorts ticked first, a second unticked first, a third resets. */
  function stepPins() {
    const pins = FRM.STEPS.map((s) => {
      const active = pin && pin.step === s.id;
      const arrow = active ? (pin.order === "done" ? "↑" : "↓") : "";
      const state = active ? (pin.order === "done" ? "cochés d'abord" : "non cochés d'abord") : "ordre officiel";
      return `<button type="button" class="step-pin${active ? ` is-${pin.order}` : ""}" data-pin="${s.id}" aria-pressed="${Boolean(active)}" title="${esc(`${s.n}. ${s.label} : ${state}`)}">${s.n}${arrow}</button>`;
    });
    return `<div class="step-pins" role="group" aria-label="Trier par étape"><span class="small muted" title="${esc(ui.stepLegend())}">Trier par étape</span>${pins.join("")}</div>`;
  }

  function nextPin(stepId) {
    if (!pin || pin.step !== stepId) return { step: stepId, order: "done" };
    return pin.order === "done" ? { step: stepId, order: "todo" } : null;
  }

  function authors() {
    const all = new Set(FRM.readings.flatMap((r) => Object.keys(FRM.notesOf(r.id))));
    return [...all].sort();
  }

  function filterBar() {
    return `
<div class="filters" data-fiches-filters>
  <div class="filter-group"><span class="filter-label">Livre</span>${ui.choiceToggles("books", filters.books, [
    { value: "all", label: "Tous" },
    ...FRM.books.map((b) => ({ value: b.id, label: `${b.id} · ${ui.shortTitle(b)}`, title: b.title })),
  ])}</div>
  <div class="filter-group"><span class="filter-label">Fiche</span>${toggles("state", STATES)}</div>
  <div class="filter-group"><span class="filter-label">Auteur</span>${ui.choiceToggles("authors", filters.authors, [
    { value: "all", label: "Tous" },
    ...authors().map((a) => ({ value: a, label: capitalized(a) })),
  ])}</div>
  <div class="filter-group"><span class="filter-label">Entrées</span>${ui.choiceToggles("entryTypes", filters.entryTypes, [
    { value: "all", label: "Tous les types" },
    ...FRM.ENTRY_TYPES.map((t) => ({ value: t.id, label: t.plural, className: ` etype-filter etype-${t.id}` })),
  ])}</div>
  <div class="filter-group"><input type="search" class="search" data-chapter placeholder="Chapitre : 10, QA-4, Bayes…" aria-label="Chercher un chapitre par numéro ou par nom"><input type="search" class="search" data-search placeholder="Entrée du corpus : bayes, VaR…" aria-label="Chercher une entrée du corpus"></div>
</div>`;
  }

  // ------------------------------------------------------------------ rows

  function noteLinks(reading, notes) {
    if (!notes.length) return `<span class="muted">pas de fiche</span>`;
    const all = FRM.notesOf(reading.id);
    return notes
      .map((a) => `<a href="${notesHref(reading, a)}">Fiche de ${esc(capitalized(a))}</a> <span class="muted">(${ui.dateTime(all[a].updatedAt)})</span>`)
      .join(" · ");
  }

  function entryChips(used) {
    const shown = filters.entryTypes === null && !filters.query.trim() ? used : matchingEntries(used);
    return shown
      .map(({ entry, authors: by }) => `<a class="entry-chip" href="${ui.entryHref(entry)}" title="${esc(`${FRM.entryType(entry.type).label} · dans la fiche de ${by.map(capitalized).join(", ")}`)}">${ui.typeTag(entry.type)} ${esc(entry.titre)}</a>`)
      .join("");
  }

  function row(reading, notes, used) {
    const chips = entryChips(used);
    return `
<div class="reading-row" data-complete="reading:${reading.id}">
  <span class="chap">${reading.chapter}</span>
  <div class="body">
    <a class="rtitle" href="${notesHref(reading, notes[0])}">${esc(reading.title)}</a>
    <div class="meta">${esc(reading.tag)} · ${noteLinks(reading, notes)}</div>
    ${chips ? `<div class="entry-chips">${chips}</div>` : ""}
  </div>
  ${ui.stepChips(reading)}
</div>`;
  }

  function render() {
    const byReading = entriesByReading();
    const me = store.profile.authorSlug();
    const rowOf = (reading) => {
      // The current profile's note first.
      const notes = Object.keys(FRM.notesOf(reading.id)).sort((a, b) => (b === me) - (a === me) || a.localeCompare(b));
      const used = byReading.get(reading.id) || [];
      return matches(reading, notes, used) ? row(reading, notes, used) : "";
    };
    let shown = 0;
    let body;
    if (pin) {
      // Sorted by a step: one flat list (the reference FRM-1, QA-4… still says the book),
      // official order kept inside each half.
      const ticked = (r) => store.progress.isDone(r.id, pin.step);
      const first = FRM.readings.filter((r) => ticked(r) === (pin.order === "done"));
      const rest = FRM.readings.filter((r) => ticked(r) !== (pin.order === "done"));
      const rows = [...first, ...rest].map(rowOf).filter(Boolean);
      shown = rows.length;
      body = `<div class="reading-list">${rows.join("")}</div>`;
    } else {
      body = FRM.books
        .map((book) => {
          const rows = book.readings.map(rowOf).filter(Boolean);
          shown += rows.length;
          return rows.length ? `<div class="map-group">Livre ${book.id} · ${esc(book.title)}</div><div class="reading-list">${rows.join("")}</div>` : "";
        })
        .join("");
    }
    document.getElementById("fiches").innerHTML = shown
      ? `<div class="list-head"><p class="small muted">${ui.plural(shown, "reading")} sur ${FRM.readings.length}</p>${stepPins()}</div>${body}`
      : `<div class="placeholder">Aucun reading ne correspond à ces filtres.</div>`;
  }

  // ------------------------------------------------------------------ page

  function start() {
    const withNotes = FRM.readings.filter((r) => Object.keys(FRM.notesOf(r.id)).length).length;
    ui.mount({
      active: "fiches",
      title: "Fiches",
      trail: [{ label: "Accueil", href: "index.html" }, { label: "Fiches" }],
      body: `
<div class="card">
  <h2>Fiches</h2>
  <p>Toutes nos fiches, reading par reading : ${ui.plural(withNotes, "reading")} sur ${FRM.readings.length} en ont au moins une. Les étiquettes sont les entrées du corpus que les fiches citent ou insèrent ; un clic sur un reading ouvre sa fiche.</p>
</div>
<div class="card">${filterBar()}<div id="fiches"></div></div>`,
    });

    // Re-render after a change (step ticked, save loaded), then refresh the chips and bars;
    // the guard stops the frm:change sent by ui.refresh() from looping back here.
    let rendering = false;
    const update = () => {
      if (rendering) return;
      rendering = true;
      render();
      ui.refresh();
      rendering = false;
    };
    update();
    document.addEventListener("frm:change", update);
    document.addEventListener("click", (event) => {
      const pinButton = event.target.closest("[data-pin]");
      if (pinButton) {
        pin = nextPin(pinButton.dataset.pin);
        return update();
      }
      const button = event.target.closest("[data-filter]"); // single choice: the note state
      if (!button) return;
      const key = button.dataset.filter;
      filters[key] = button.dataset.value;
      document.querySelectorAll(`[data-filter="${key}"]`).forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      update();
    });
    ui.watchChoiceToggles(document.querySelector("[data-fiches-filters]"), filters, update);
    document.querySelector("[data-chapter]").addEventListener("input", (event) => {
      filters.chapter = event.target.value;
      update();
    });
    document.querySelector("[data-search]").addEventListener("input", (event) => {
      filters.query = event.target.value;
      update();
    });
  }

  const optional = (src) => ui.loadScript(src).catch(() => {
    /* not written yet: the server writes it when it starts */
  });
  Promise.all([optional("notes/index.js"), optional("notes/corpus/index.js")]).then(start);
})(window.FRM, window.FRM.ui);
