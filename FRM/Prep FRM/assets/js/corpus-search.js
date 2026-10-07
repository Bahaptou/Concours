/* Corpus search bar, shared by the editors' "📚 Corpus" menu (editor/corpus-picker.js) and the
 * series setup of the Questions page (pages/quiz.js): types, books and contributors (multi-select,
 * FRM.toggleChoice), reading and attachment selects, "Entrées liées", text search. It only
 * filters; what to do with an entry is up to the caller. A classic script, so that the series
 * setup also works without the server (file://). */
(function (FRM, ui) {
  "use strict";

  const { esc, fold } = ui;
  const NO_READING = "none"; // book value: entries in no reading (no note, no linked question)

  const booksOf = (entry) => new Set(entry.readings.map(FRM.findReading).filter(Boolean).map((reading) => FRM.bookOf(reading).id));

  /**
   * Fills `box` with the bar and returns { search, setEntries(all), results() }.
   * onChange(): called after any change of a filter or of the search, for the caller to re-render.
   * offer(entry): whether an entry may be offered (not the one being edited, has linked questions…);
   *   the others still carry links for "Entrées liées".
   * state: an object holding the filters, mutated in place, for a caller that rebuilds the bar and
   *   wants to keep them; a bar keeps its own otherwise.
   * placeholder: the search field's.
   * Types, contributors and the attachment are shown only when they offer a choice.
   */
  function create(box, { onChange = () => {}, offer = () => true, state = {}, placeholder = "Chercher : titre ou identifiant…" } = {}) {
    // types, books, authors (contributors: created or changed the entry): null (everything) or a
    // Set (FRM.toggleChoice); reading: "all" or an id.
    const filters = Object.assign(state, { types: null, books: null, authors: null, reading: "all", attach: "all", linked: 0, query: "", ...state });
    let entries = [];
    box.innerHTML = `
<div class="picker-filters" data-picker-filters></div>
<input type="search" class="search" data-corpus-query placeholder="${esc(placeholder)}" aria-label="Chercher dans le corpus" value="${esc(filters.query)}">`;
    const filterBox = box.querySelector("[data-picker-filters]");
    const search = box.querySelector("[data-corpus-query]");

    const pool = () => entries.filter((entry) => offer(entry));
    const chosenBooks = () => (filters.books === null ? FRM.books : FRM.books.filter((book) => filters.books.has(String(book.id))));

    /** What to show, as opposed to where to look: linked entries obey these filters too. */
    const matchesWhat = (entry) =>
      offer(entry) &&
      FRM.isChosen(filters.types, entry.type) &&
      (filters.authors === null || FRM.contributorsOf(entry.journal).some((author) => filters.authors.has(author)));

    const matchesBooks = (entry) =>
      filters.books === null ||
      (filters.books.has(NO_READING) && !entry.readings.length) ||
      [...booksOf(entry)].some((id) => filters.books.has(String(id)));

    /** Every filter but the attachment (whose options count these entries). */
    const matchesWhere = (entry, query) =>
      matchesWhat(entry) &&
      matchesBooks(entry) &&
      (filters.reading === "all" || entry.readings.includes(Number(filters.reading))) &&
      (!query || fold(`${entry.titre} ${entry.id}`).includes(query));

    const matches = (entry, query) =>
      matchesWhere(entry, query) && FRM.matchesAttachment(entry, filters.attach, FRM.attachmentScope(filters.reading, filters.books));

    const attachLabel = (a) => (a.id === "all" ? "Tout rattachement" : a.label);

    /** Each attachment option with the number of entries it would show, the other filters kept. */
    function refreshAttachCounts() {
      const select = filterBox.querySelector('[data-picker-select="attach"]');
      if (!select) return;
      const kept = pool().filter((entry) => matchesWhere(entry, fold(filters.query.trim())));
      const counts = FRM.attachmentCounts(kept, FRM.attachmentScope(filters.reading, filters.books));
      for (const option of select.options) {
        const a = FRM.ATTACHMENTS.find((x) => x.id === option.value);
        option.textContent = `${attachLabel(a)} (${counts[a.id]})`;
      }
    }

    function changed() {
      refreshAttachCounts();
      onChange();
    }

    /** Keeps the reading and the attachment consistent with the chosen books. */
    function reconcile() {
      if (filters.reading !== "all" && !chosenBooks().some((book) => book.readings.some((r) => String(r.id) === String(filters.reading)))) filters.reading = "all";
      // "Fiche ou questions" and "Ni fiche ni question" only make sense without a reading or book.
      const unscoped = FRM.ATTACHMENTS.find((a) => a.id === filters.attach)?.unscoped;
      if (unscoped && FRM.attachmentScope(filters.reading, filters.books)) filters.attach = "all";
    }

    function renderFilters() {
      const offered = pool();
      const scoped = FRM.attachmentScope(filters.reading, filters.books) !== null;
      const count = (fn) => offered.filter(fn).length;
      const counted = (text, n) => (n ? `${text} (${n})` : text);
      const row = (label, html) => `<div class="filter-group">${label ? `<span class="filter-label">${label}</span>` : ""}${html}</div>`;

      const types = FRM.ENTRY_TYPES.filter((type) => offered.some((entry) => entry.type === type.id));
      const typeRow = types.length > 1
        ? row("", ui.choiceToggles("types", filters.types, [
            { value: "all", label: `Tous les types (${offered.length})` },
            ...types.map((type) => ({ value: type.id, label: `${type.plural} (${count((e) => e.type === type.id)})`, className: ` etype-filter etype-${type.id}` })),
          ], { small: true }))
        : "";
      const bookRow = row("Livre", ui.choiceToggles("books", filters.books, [
        { value: "all", label: `Tous (${offered.length})` },
        ...FRM.books.map((book) => ({ value: book.id, label: counted(`${book.id} · ${ui.shortTitle(book)}`, count((entry) => booksOf(entry).has(book.id))), title: book.title })),
        { value: NO_READING, label: `Sans reading (${count((entry) => !entry.readings.length)})`, title: "Ni une fiche ni une question liée ne la rattache à un reading" },
      ], { small: true }));
      const authors = new Map();
      offered.forEach((entry) => (entry.journal || []).forEach((session) => authors.set(session.author, session.name)));
      const authorRow = authors.size > 1
        ? row("Contributeur", ui.choiceToggles("authors", filters.authors, [
            { value: "all", label: `Tous (${offered.length})` },
            ...[...authors].sort((a, b) => a[1].localeCompare(b[1], "fr")).map(([slug, name]) => ({ value: slug, label: `${name} (${count((e) => FRM.contributorsOf(e.journal).includes(slug))})` })),
          ], { small: true }))
        : "";

      const option = (value, text, current) => `<option value="${esc(String(value))}"${String(current) === String(value) ? " selected" : ""}>${esc(text)}</option>`;
      const select = (name, label, options, extra = "") => `<select class="picker-select" data-picker-select="${name}" aria-label="${label}"${extra}>${options.join("")}</select>`;
      // The readings follow the chosen books; "Sans reading" alone leaves none to choose.
      const readingBooks = chosenBooks();
      const readingSelect = select("reading", "Reading", [
        option("all", "Tous les readings", filters.reading),
        ...readingBooks.map((book) => `<optgroup label="${esc(`Livre ${book.id} · ${ui.shortTitle(book)}`)}">${book.readings.map((reading) => option(reading.id, counted(`${reading.tag} · ${reading.title}`, count((entry) => entry.readings.includes(reading.id))), filters.reading)).join("")}</optgroup>`),
      ], readingBooks.length ? "" : " disabled");
      const attachSelect = offered.some((entry) => entry.readings.length)
        ? select("attach", "Rattachement : fiche et/ou questions, dans le reading choisi, sinon les livres choisis, sinon n'importe quel reading", FRM.ATTACHMENTS.map((a) => {
            const disabled = a.unscoped && scoped;
            return option(a.id, attachLabel(a), filters.attach).replace("<option", disabled ? "<option disabled" : "<option");
          }))
        : "";
      filterBox.innerHTML = `${typeRow}${bookRow}${authorRow}${row("", `${readingSelect}${attachSelect}${ui.linkedControl(filters.linked)}`)}`;
      refreshAttachCounts();
    }

    search.addEventListener("input", () => {
      filters.query = search.value;
      changed();
    });
    // Inside a form (series setup), Enter must not submit it.
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("input") && event.target.form) event.preventDefault();
    });
    ui.watchLinkedControl(filterBox, (depth) => {
      filters.linked = depth;
      onChange();
    });
    filterBox.addEventListener("mousedown", (event) => event.target.closest("button") && event.preventDefault());
    ui.watchChoiceToggles(filterBox, filters, (key) => {
      if (key === "books") {
        reconcile();
        renderFilters();
      }
      changed();
    });
    filterBox.addEventListener("change", (event) => {
      const select = event.target.closest("[data-picker-select]");
      if (!select) return;
      filters[select.dataset.pickerSelect] = select.value;
      if (select.dataset.pickerSelect === "reading") {
        reconcile();
        renderFilters();
      }
      changed();
    });

    return {
      search,
      /** All the entries (those not offered still carry links); rebuilds the filters' counts. */
      setEntries(all) {
        entries = all;
        renderFilters();
      },
      /** { offered, shown, linked }: offered entries, those matching, and the linked ones
       *  ({ entry, via }, FRM.linkedTo) to show greyed. */
      results() {
        const shown = pool().filter((entry) => matches(entry, fold(filters.query.trim())));
        return { offered: pool(), shown, linked: FRM.linkedTo(shown, filters.linked, entries, matchesWhat) };
      },
    };
  }

  FRM.corpusSearch = { create };
})(window.FRM, window.FRM.ui);
