/* Corpus page: our shared formulas, definitions, properties, theorems and simulations.
 *
 * corpus.html shows the entries as a list or as statistics (corpus-stats.js), with the same
 * filters (type, book, reading, author, search) and a sort for the list; corpus.html?id=bayes
 * shows one entry: its shared text, who created and changed it, its links, and the Python code of a simulation.
 * Everything comes from notes/corpus/index.js, written by the server: the page also works
 * without it (file://), only writing needs it. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const { store } = FRM;
  const withServer = location.protocol.startsWith("http");
  const params = new URLSearchParams(location.search);

  const editorHref = (entry) => (entry ? `entree.html?id=${encodeURIComponent(entry.id)}` : "entree.html");
  const readingLabel = (reading) => `${reading.tag} · ${reading.title}`;
  const pageUrl = (path, entry) => `${path}?v=${entry.updatedAt}`; // never show a cached older rendering

  function serverHint(what) {
    return `<span class="small muted">Pour ${what}, lance <code>Lancer Prep FRM.bat</code>.</span>`;
  }

  /** Initials of whoever created and changed the entry; a red "!" when its text does not compile. */
  function badgesOf(entry) {
    const broken = entry.hasText && !entry.valid
      ? `<span class="initials is-invalid" title="Ne compile pas : les fiches gardent le dernier texte qui compilait">!</span>`
      : "";
    return ui.contributorBadges(entry.journal) + broken;
  }

  const readingRefs = (entry) =>
    entry.readings
      .map(FRM.findReading)
      .filter(Boolean)
      .map((r) => r.tag)
      .join(", ");

  // ------------------------------------------------------------------ filters and sort

  const NO_READING = "none"; // book value: entries in no reading (no note, no linked question)

  // types, books, authors: multi-select, null (everything) or a Set of strings (FRM.toggleChoice).
  const filters = {
    types: FRM.entryType(params.get("type")) ? new Set([params.get("type")]) : null,
    books: null, // book ids and NO_READING
    reading: FRM.findReading(params.get("reading")) ? Number(params.get("reading")) : null,
    authors: null,
    attach: "all", // FRM.ATTACHMENTS, within the chosen reading, else the chosen book, else any reading
    query: "",
    linked: 0, // FRM.linkedTo depth: 0 none, Infinity the whole chain (list and graph, not stats)
  };
  let sort = "titre";
  let view = ["stats", "graphe"].includes(params.get("vue")) ? params.get("vue") : "list";

  const booksOf = (entry) => new Set(entry.readings.map((r) => FRM.findReading(r)).filter(Boolean).map((r) => FRM.bookOf(r).id));
  const lastUpdate = (entry) => entry.updatedAt || 0;

  function matchesBook(entry) {
    if (filters.books === null) return true;
    if (filters.books.has(NO_READING) && !entry.readings.length) return true;
    return [...booksOf(entry)].some((id) => filters.books.has(String(id)));
  }

  /** The books whose readings can be chosen: every one, or the chosen ones ("Sans reading" has none). */
  const readingBooks = () => (filters.books === null ? FRM.books : FRM.books.filter((book) => filters.books.has(String(book.id))));

  /** The reading select follows the chosen books: their readings only, and a reading outside them
   *  goes back to "Tous les readings". */
  function syncReadingSelect() {
    const books = readingBooks();
    if (filters.reading !== null && !books.some((book) => book.readings.some((r) => r.id === filters.reading))) filters.reading = null;
    const select = document.querySelector("[data-reading-filter]");
    select.innerHTML = readingOptions();
    select.disabled = !books.length;
  }

  /** "Fiche ou questions" and "Ni fiche ni question" are greyed out while a reading or a book is chosen. */
  function syncAttachFilter() {
    const scoped = FRM.attachmentScope(filters.reading, filters.books) !== null;
    for (const a of FRM.ATTACHMENTS.filter((a) => a.unscoped)) {
      const button = document.querySelector(`[data-filter="attach"][data-value="${a.id}"]`);
      if (!button) continue;
      button.disabled = scoped;
      button.title = scoped ? "Avec un reading ou un livre choisi, toutes les entrées affichées y sont rattachées : choisis « Tous les livres » et « Tous les readings »" : a.title;
      if (scoped && filters.attach === a.id) {
        filters.attach = "all";
        document.querySelectorAll('[data-filter="attach"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === "all")));
      }
    }
  }

  /** What to show, as opposed to where to look: linked entries obey these filters too. */
  const matchesWhat = (entry) =>
    FRM.isChosen(filters.types, entry.type) && (filters.authors === null || FRM.contributorsOf(entry.journal).some((a) => filters.authors.has(a)));

  /** The entries the filters keep; without the attachment filter for its counts. */
  function visibleEntries({ attach = true } = {}) {
    const query = ui.fold(filters.query.trim());
    const scope = FRM.attachmentScope(filters.reading, filters.books);
    return FRM.corpusEntries().filter(
      (entry) =>
        matchesWhat(entry) &&
        matchesBook(entry) &&
        (filters.reading === null || entry.readings.includes(filters.reading)) &&
        (!attach || FRM.matchesAttachment(entry, filters.attach, scope)) &&
        (!query || ui.fold(`${entry.titre} ${entry.id}`).includes(query))
    );
  }

  /** Each "Rattachement" option with the number of entries it would show, the other filters kept. */
  function syncAttachCounts() {
    const counts = FRM.attachmentCounts(visibleEntries({ attach: false }), FRM.attachmentScope(filters.reading, filters.books));
    for (const a of FRM.ATTACHMENTS) {
      const button = document.querySelector(`[data-filter="attach"][data-value="${a.id}"]`);
      if (button) button.textContent = `${a.label} (${counts[a.id]})`;
    }
  }

  const SORTS = {
    titre: { label: "Titre", compare: (a, b) => a.titre.localeCompare(b.titre, "fr") },
    usage: { label: "Plus utilisées", compare: (a, b) => FRM.corpusStats.usesOf(b) - FRM.corpusStats.usesOf(a) || a.titre.localeCompare(b.titre, "fr") },
    recent: { label: "Plus récentes", compare: (a, b) => lastUpdate(b) - lastUpdate(a) },
  };

  // ------------------------------------------------------------------ list

  /** A row of the list; `via` (ids) for an entry added by "Entrées liées", shown greyed. */
  function entryRow(entry, via = null) {
    const refs = readingRefs(entry);
    return `
<a class="entry-row${via ? " is-linked" : ""}" href="${ui.entryHref(entry)}">
  ${ui.typeTag(entry.type)}
  <span class="etitle">${esc(entry.titre)} <span class="entry-id">${esc(entry.id)}</span>${via ? `<span class="elinked">${esc(FRM.linkedLabel(via, FRM.corpusEntries()))}</span>` : ""}</span>
  ${refs ? `<span class="ereadings">${esc(refs)}</span>` : ""}
  <span class="eauthors">${badgesOf(entry)}</span>
</a>`;
  }

  function renderList() {
    syncAttachCounts();
    const list = visibleEntries();
    const total = FRM.corpusEntries().length;
    const container = document.getElementById("entries");
    document.querySelector("[data-sort]").hidden = view !== "list";
    document.querySelector("[data-linked-group]").hidden = view === "stats";
    if (!total) {
      container.innerHTML = `<div class="placeholder">Le corpus est vide pour l'instant. ${withServer ? "Crée la première entrée avec « Nouvelle entrée »." : "Il se remplit depuis l'éditeur, avec le serveur lancé."}</div>`;
      return;
    }
    if (view === "stats") return FRM.corpusStats.render(container, list);
    const linked = FRM.linkedTo(list, filters.linked, FRM.corpusEntries(), matchesWhat);
    if (view === "graphe") {
      // Same filters as the list, and the same linked entries, pale.
      return FRM.corpusGraph.render(container, list, { linked: linked.map((l) => l.entry), paleLinks: filters.linked > 1 });
    }
    list.sort(SORTS[sort].compare);
    linked.sort((a, b) => SORTS[sort].compare(a.entry, b.entry));
    const more = linked.length ? `, et ${linked.length} ${linked.length > 1 ? "entrées liées" : "entrée liée"} en grisé` : "";
    container.innerHTML = list.length
      ? `<p class="small muted">${ui.plural(list.length, "entrée")} sur ${total}${more}</p><div class="entry-list">${list.map((entry) => entryRow(entry)).join("")}${linked.map((l) => entryRow(l.entry, l.via)).join("")}</div>`
      : `<div class="placeholder">Aucune entrée ne correspond à ces filtres.</div>`;
  }

  /** A row of toggle buttons; `key` names the filter they set. */
  function toggles(key, options) {
    return options
      .map((o) => `<button type="button" class="toggle${o.className || ""}" data-filter="${key}" data-value="${esc(String(o.value))}" aria-pressed="${filters[key] === o.value}"${o.title ? ` title="${esc(o.title)}"` : ""}>${esc(o.label)}</button>`)
      .join("");
  }

  function bookFilters() {
    const count = (fn) => FRM.corpusEntries().filter(fn).length;
    return ui.choiceToggles("books", filters.books, [
      { value: "all", label: `Tous les livres (${FRM.corpusEntries().length})` },
      ...FRM.books.map((b) => ({ value: b.id, label: `${b.id} · ${ui.shortTitle(b)} (${count((e) => booksOf(e).has(b.id))})`, title: b.title })),
      { value: NO_READING, label: `Sans reading (${count((e) => !e.readings.length)})`, title: "Ni une fiche ni une question liée ne la rattache à un reading" },
    ]);
  }

  function authorFilters() {
    const authors = [...FRM.corpusStats.authorsOf(FRM.corpusEntries()).entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "fr"));
    return ui.choiceToggles("authors", filters.authors, [
      { value: "all", label: `Tous les contributeurs (${FRM.corpusEntries().length})` },
      ...authors.map(([slug, a]) => ({ value: slug, label: `${a.name} · ${a.initials} (${a.entries})`, title: `A créé ${a.created}, a contribué à ${a.entries}` })),
    ]);
  }

  function typeFilters() {
    const counts = Object.fromEntries(FRM.ENTRY_TYPES.map((t) => [t.id, 0]));
    FRM.corpusEntries().forEach((entry) => (counts[entry.type] += 1));
    return ui.choiceToggles("types", filters.types, [
      { value: "all", label: `Tous les types (${FRM.corpusEntries().length})` },
      ...FRM.ENTRY_TYPES.map((t) => ({ value: t.id, label: `${t.plural} (${counts[t.id]})`, className: ` etype-filter etype-${t.id}` })),
    ]);
  }

  function readingOptions() {
    const groups = readingBooks().map((book) => {
      const options = book.readings.map(
        (r) => `<option value="${r.id}"${filters.reading === r.id ? " selected" : ""}>${esc(readingLabel(r))}</option>`
      );
      return `<optgroup label="${esc(`Livre ${book.id} · ${ui.shortTitle(book)}`)}">${options.join("")}</optgroup>`;
    });
    return `<option value="">Tous les readings</option>${groups.join("")}`;
  }

  function readingSelect() {
    return `<select class="search" data-reading-filter aria-label="Reading">${readingOptions()}</select>`;
  }

  function mountList() {
    ui.mount({
      active: "corpus",
      title: "Corpus",
      trail: [{ label: "Accueil", href: "index.html" }, { label: "Corpus" }],
      body: `
<div class="card">
  <h2>Corpus</h2>
  <p>Nos formules, définitions, propriétés, théorèmes et simulations, écrits par nous. Chaque entrée a un identifiant lisible, un titre et un texte commun, que chacun peut modifier ; son historique dit qui l'a créée et qui l'a modifiée. Ses readings sont ceux des fiches qui la citent ou l'insèrent, et des questions qui lui sont liées.</p>
  <p class="small muted">Dans une fiche : <code>#voir("id")</code> cite une entrée (son titre), <code>#entree("id")</code> l'insère en entier. Une entrée peut en citer une autre.</p>
  <div class="save-actions">${withServer ? `<a class="btn" href="${editorHref()}">+ Nouvelle entrée</a>` : serverHint("créer ou modifier une entrée")}</div>
</div>
<div class="card">
  <div class="view-switch" role="group" aria-label="Vue">
    <button type="button" class="toggle" data-view="list" aria-pressed="${view === "list"}">Liste</button>
    <button type="button" class="toggle" data-view="stats" aria-pressed="${view === "stats"}">Stats</button>
    <button type="button" class="toggle" data-view="graphe" aria-pressed="${view === "graphe"}">Graphe</button>
  </div>
  <div class="filters" data-corpus-filters>
    <div class="filter-group"><span class="filter-label">Type</span>${typeFilters()}</div>
    <div class="filter-group"><span class="filter-label">Livre</span>${bookFilters()}</div>
    <div class="filter-group" title="A créé ou modifié l'entrée"><span class="filter-label">Contributeur</span>${authorFilters()}</div>
    <div class="filter-group" title="Dans le reading choisi, sinon dans les livres choisis, sinon dans n'importe quel reading"><span class="filter-label">Rattachement</span>${toggles("attach", FRM.ATTACHMENTS.map((a) => ({ value: a.id, label: a.label, title: a.title })))}</div>
    <div class="filter-group" data-linked-group>${ui.linkedControl(filters.linked)}</div>
    <div class="filter-group">${readingSelect()}<input type="search" class="search" data-search placeholder="Titre ou identifiant…" aria-label="Rechercher">
      <select class="search" data-sort aria-label="Tri">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">Tri : ${esc(s.label)}</option>`).join("")}</select></div>
  </div>
  <div id="entries"></div>
</div>`,
    });
    syncAttachFilter();
    renderList();

    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        view = viewButton.dataset.view;
        document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b === viewButton)));
        return renderList();
      }
      const button = event.target.closest("[data-filter]"); // single choice: the attachment
      if (!button) return;
      const key = button.dataset.filter;
      filters[key] = button.dataset.value;
      document.querySelectorAll(`[data-filter="${key}"]`).forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      renderList();
    });
    ui.watchChoiceToggles(document.querySelector("[data-corpus-filters]"), filters, (key) => {
      if (key === "books") {
        syncReadingSelect();
        syncAttachFilter();
      }
      renderList();
    });
    document.querySelector("[data-sort]").addEventListener("change", (event) => {
      sort = event.target.value;
      renderList();
    });
    document.querySelector("[data-reading-filter]").addEventListener("change", (event) => {
      filters.reading = event.target.value ? Number(event.target.value) : null;
      syncAttachFilter();
      renderList();
    });
    ui.watchLinkedControl(document.querySelector("[data-linked-group]"), (depth) => {
      filters.linked = depth;
      renderList();
    });
    document.querySelector("[data-search]").addEventListener("input", (event) => {
      filters.query = event.target.value;
      renderList();
    });
  }

  // ------------------------------------------------------------------ one entry

  /** The entry's shared text: its rendering (the last that compiled) and its code. */
  function textBlock(entry) {
    const pages = entry.pages.map((path, i) => `<img class="note-page" src="${pageUrl(path, entry)}" alt="${esc(`${entry.titre}, page ${i + 1}`)}">`);
    const broken = entry.hasText && !entry.valid
      ? `<p><span class="tag accent">Ne compile pas : les fiches gardent le dernier texte qui compilait, jusqu'à correction</span></p>`
      : "";
    const code = entry.code ? `<h3>Code Python</h3>${ui.codeBlock(entry.code)}${FRM.runner.slot(entry)}` : "";
    const empty = entry.hasText ? "" : `<div class="placeholder">Pas encore de texte.</div>`;
    return `${broken}${pages.length ? `<div class="note-pages">${pages.join("")}</div>` : empty}${code}`;
  }

  function entryLinks(ids) {
    const items = ids.map((id) => {
      const other = FRM.findEntry(id);
      return other ? `<li>${ui.typeTag(other.type)} <a href="${ui.entryHref(other)}">${esc(other.titre)}</a></li>` : `<li class="muted">${esc(id)} (inconnue)</li>`;
    });
    return items.length ? `<ul>${items.join("")}</ul>` : `<p class="small muted">Aucune.</p>`;
  }

  function noteLinks(uses) {
    const items = uses.map((use) => {
      const reading = FRM.findReading(use.reading);
      if (!reading) return "";
      return `<li><a href="${ui.readingHref(reading)}#notes-card">${esc(reading.tag)}</a> · ${esc(reading.title)}</li>`;
    });
    return items.length ? `<ul>${items.join("")}</ul>` : `<p class="small muted">Aucune.</p>`;
  }

  /** AnalystPrep questions linked to the entry (from the questions page): each opens on its own. */
  function questionLinks(entry) {
    const items = (entry.questions || []).map((q) => {
      const reading = FRM.findReading(q.reading);
      if (!reading) return "";
      return `<li><a href="question.html?reading=${reading.id}&amp;q=${encodeURIComponent(q.id)}" title="${esc(reading.title)}">${esc(reading.tag)} · Q.${esc(q.id)}</a></li>`;
    });
    return items.length
      ? `<ul>${items.join("")}</ul>`
      : `<p class="small muted">Aucune. On lie une question depuis la page Questions (bouton 📚 Corpus sous la question).</p>`;
  }

  function mountEntry(entry) {
    // Each reading says where it comes from: a note citing the entry, questions linked to it, or both.
    const readings = entry.readings
      .map(FRM.findReading)
      .filter(Boolean)
      .map((r) => {
        const { note, question } = FRM.attachmentOf(entry, r.id);
        const origin = [note && "fiche", question && "questions"].filter(Boolean).join(" · ");
        return `<a class="tag" href="${ui.readingHref(r)}" title="${esc(`${r.title} — via ${origin}`)}">${esc(r.tag)} <span class="tag-src">${esc(origin)}</span></a>`;
      });
    const actions = withServer
      ? `<a class="btn" href="${editorHref(entry)}">${entry.hasText ? "✎ Modifier l'entrée" : "✎ Écrire le texte"}</a>`
      : serverHint("modifier l'entrée");

    ui.mount({
      active: "corpus",
      title: entry.titre,
      trail: [
        { label: "Accueil", href: "index.html" },
        { label: "Corpus", href: "corpus.html" },
        { label: entry.titre },
      ],
      body: `
<div class="card entry-head">
  <div class="entry-meta">${ui.typeTag(entry.type)} <span class="entry-id">${esc(entry.id)}</span></div>
  <h2>${esc(entry.titre)}</h2>
  <div class="entry-meta">${readings.join("") || `<span class="small muted">Aucun reading : ni une fiche ni une question liée ne la rattache.</span>`}</div>
  ${entry.journal.length ? `<p class="small muted">${ui.journalLine(entry.journal)}</p>` : ""}
  <div class="snippets">
    <span>Citer : <code>#voir("${esc(entry.id)}")</code></span>
    <span>Insérer dans une fiche : <code>#entree("${esc(entry.id)}")</code></span>
  </div>
  <div class="save-actions">${actions}${(entry.questions || []).length ? `<a class="btn ghost" href="quiz.html?entries=${encodeURIComponent(entry.id)}">Série sur ses questions (${entry.questions.length})</a>` : ""}</div>
</div>
<div class="card">
  <h2>Texte</h2>
  ${textBlock(entry)}
</div>
<div class="card">
  <h2>Liens</h2>
  <div class="links-grid">
    <div><h3>Cite</h3>${entryLinks(entry.cites)}</div>
    <div><h3>Citée par</h3>${entryLinks(entry.citedBy || [])}</div>
    <div><h3>Utilisée dans les fiches</h3>${noteLinks(entry.usedBy || [])}</div>
    <div><h3>Questions liées</h3>${questionLinks(entry)}</div>
    ${(entry.imports || []).length || entry.type === "simulation" ? `<div><h3>Briques importées</h3>${entryLinks(entry.imports || [])}</div>` : ""}
    ${entry.type === "brique" ? `<div><h3>Importée par</h3>${entryLinks(entry.importedBy || [])}</div>` : ""}
  </div>
  <p class="src">Liens relevés dans les textes (<code>#voir</code>, <code>#entree</code>, <code>from briques.… import</code>), mis à jour à chaque enregistrement.</p>
</div>`,
    });
    FRM.runner.mountSlots(document.getElementById("app"));
  }

  // ------------------------------------------------------------------ start

  function start() {
    const id = params.get("id");
    if (id === null) return mountList();
    const entry = FRM.findEntry(id);
    return entry ? mountEntry(entry) : ui.mountNotFound(`L'entrée « ${id} » du corpus`);
  }

  ui.loadScript("notes/corpus/index.js")
    .catch(() => {
      /* no corpus yet: the server writes the manifest when it starts */
    })
    .then(start);
})(window.FRM, window.FRM.ui);
