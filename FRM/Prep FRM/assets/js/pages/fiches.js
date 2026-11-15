/* Notes portal (fiches.html): every reading in the official order, with its steps, its shared note
 * and the corpus entries it cites or inserts. Filters: books, contributors and entry types
 * (multi-select, FRM.toggleChoice), note state, chapter (search) and corpus entry (search);
 * four step pins sort by a ticked step.
 * A click opens the reading page on its notes card.
 * Data: notes/index.js (the note of each reading, with its journal) and notes/corpus/index.js (entries and
 * the notes using them), both written by the server and readable without it. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const { store } = FRM;
  const LAST_STEP = FRM.STEPS[FRM.STEPS.length - 1].id; // ④, the note

  // books, authors (contributors: created or changed the note), entryTypes: multi-select, null
  // (everything) or a Set of strings (FRM.toggleChoice).
  const filters = { books: null, state: "all", authors: null, entryTypes: null, chapter: "", query: "" };
  // Step pin: sort by one step, ticked first ("done") or unticked first ("todo"); null = official order.
  let pin = null;

  // ------------------------------------------------------------------ data

  const notesHref = (reading) => `reading.html?id=${reading.id}#notes-card`;

  /** {reading id: [{ entry }]}: the corpus entries each reading's note uses. */
  function entriesByReading() {
    const byReading = new Map();
    for (const entry of FRM.corpusEntries()) {
      for (const use of entry.usedBy || []) {
        const list = byReading.get(use.reading) || [];
        if (!list.some((item) => item.entry === entry)) list.push({ entry });
        byReading.set(use.reading, list);
      }
    }
    return byReading;
  }

  // ------------------------------------------------------------------ filters

  const STATES = [
    { value: "all", label: "Tous les readings" },
    { value: "with", label: "Avec fiche", test: (r, note) => note !== null },
    { value: "without", label: "Sans fiche", test: (r, note) => note === null },
    { value: "unchecked", label: "Fiche écrite, ④ non cochée", test: (r, note) => note !== null && !store.progress.isDone(r.id, LAST_STEP) },
    { value: "missing", label: "④ cochée sans fiche", test: (r, note) => note === null && store.progress.isDone(r.id, LAST_STEP) },
  ];

  function matches(reading, note, used) {
    if (!FRM.isChosen(filters.books, FRM.bookOf(reading).id)) return false;
    if (!matchesChapter(reading)) return false;
    const state = STATES.find((s) => s.value === filters.state);
    if (state.test && !state.test(reading, note)) return false;
    if (filters.authors !== null && !(note && FRM.contributorsOf(note.journal).some((author) => filters.authors.has(author)))) return false;
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

  /** [slug, name] of everyone who created or changed a note, by name. */
  function authors() {
    const all = new Map();
    FRM.readings.forEach((r) => (FRM.noteOf(r.id)?.journal || []).forEach((s) => all.set(s.author, s.name)));
    return [...all].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }

  function filterBar() {
    return `
<div class="filters" data-fiches-filters>
  <div class="filter-group"><span class="filter-label">Livre</span>${ui.choiceToggles("books", filters.books, [
    { value: "all", label: "Tous" },
    ...FRM.books.map((b) => ({ value: b.id, label: `${b.id} · ${ui.shortTitle(b)}`, title: b.title })),
  ])}</div>
  <div class="filter-group"><span class="filter-label">Fiche</span>${toggles("state", STATES)}</div>
  <div class="filter-group" title="A créé ou modifié la fiche"><span class="filter-label">Contributeur</span>${ui.choiceToggles("authors", filters.authors, [
    { value: "all", label: "Tous" },
    ...authors().map(([slug, name]) => ({ value: slug, label: name })),
  ])}</div>
  <div class="filter-group"><span class="filter-label">Entrées</span>${ui.choiceToggles("entryTypes", filters.entryTypes, [
    { value: "all", label: "Tous les types" },
    ...FRM.ENTRY_TYPES.map((t) => ({ value: t.id, label: t.plural, className: ` etype-filter etype-${t.id}` })),
  ])}</div>
  <div class="filter-group"><input type="search" class="search" data-chapter placeholder="Chapitre : 10, QA-4, Bayes…" aria-label="Chercher un chapitre par numéro ou par nom"><input type="search" class="search" data-search placeholder="Entrée du corpus : bayes, VaR…" aria-label="Chercher une entrée du corpus"></div>
</div>`;
  }

  // ------------------------------------------------------------------ rows

  /** The note's link, its contributors' initials and its last change. */
  function noteLink(reading, note) {
    if (!note) return `<span class="muted">pas de fiche</span>`;
    return `<a href="${notesHref(reading)}">La fiche</a> ${ui.contributorBadges(note.journal)} <span class="muted">(modifiée le ${ui.dateTime(note.updatedAt)})</span>`;
  }

  function entryChips(used) {
    const shown = filters.entryTypes === null && !filters.query.trim() ? used : matchingEntries(used);
    return shown
      .map(({ entry }) => `<a class="entry-chip" href="${ui.entryHref(entry)}" title="${esc(`${FRM.entryType(entry.type).label} · dans la fiche`)}">${ui.typeTag(entry.type)} ${esc(entry.titre)}</a>`)
      .join("");
  }

  function row(reading, note, used) {
    const chips = entryChips(used);
    return `
<div class="reading-row" data-complete="reading:${reading.id}">
  <span class="chap">${reading.chapter}</span>
  <div class="body">
    <a class="rtitle" href="${notesHref(reading)}">${esc(reading.title)}</a>
    <div class="meta">${esc(reading.tag)} · ${noteLink(reading, note)}</div>
    ${chips ? `<div class="entry-chips">${chips}</div>` : ""}
  </div>
  ${ui.stepChips(reading)}
</div>`;
  }

  function render() {
    const byReading = entriesByReading();
    const rowOf = (reading) => {
      const note = FRM.noteOf(reading.id);
      const used = byReading.get(reading.id) || [];
      return matches(reading, note, used) ? row(reading, note, used) : "";
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
    const withNotes = FRM.readings.filter((r) => FRM.noteOf(r.id)).length;
    ui.mount({
      active: "fiches",
      title: "Fiches",
      trail: [{ label: "Accueil", href: "index.html" }, { label: "Fiches" }],
      body: `
<div class="card">
  <h2>Fiches</h2>
  <p>Nos fiches, une par reading, communes à tous : ${ui.plural(withNotes, "reading")} sur ${FRM.readings.length} en ont une. Les initiales disent qui l'a créée et modifiée ; les étiquettes sont les entrées du corpus qu'elle cite ou insère ; un clic sur un reading ouvre sa fiche.</p>
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
