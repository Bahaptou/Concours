/* Corpus page: our shared formulas, definitions, properties, theorems and simulations.
 *
 * corpus.html shows the entries as a list or as statistics (corpus-stats.js), with the same
 * filters (type, book, reading, author, search) and a sort for the list; corpus.html?id=bayes
 * shows one entry: every author's version, its links, and the Python code of a simulation.
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
  const versionUrl = (path, version) => `${path}?v=${version.updatedAt}`; // never show a cached older rendering

  function serverHint(what) {
    return `<span class="small muted">Pour ${what}, lance <code>Lancer Prep FRM.bat</code>.</span>`;
  }

  /** Initials badges of an entry's versions; an invalid version (does not compile) shows in red. */
  function initialsOf(entry) {
    return entry.versions
      .map((v) => {
        const title = `${v.name}${v.valid ? "" : " · ne compile pas : absente des fiches"}`;
        return `<span class="initials${v.valid ? "" : " is-invalid"}" title="${esc(title)}">${esc(v.initials)}</span>`;
      })
      .join("");
  }

  const readingRefs = (entry) =>
    entry.readings
      .map(FRM.findReading)
      .filter(Boolean)
      .map((r) => r.tag)
      .join(", ");

  // ------------------------------------------------------------------ filters and sort

  const NO_READING = "none"; // entries no note uses yet

  const filters = {
    type: FRM.entryType(params.get("type")) ? params.get("type") : "all",
    book: "all", // "all", a book id, or NO_READING
    reading: FRM.findReading(params.get("reading")) ? Number(params.get("reading")) : null,
    author: "all",
    query: "",
  };
  let sort = "titre";
  let view = params.get("vue") === "stats" ? "stats" : "list";

  const booksOf = (entry) => new Set(entry.readings.map((r) => FRM.findReading(r)).filter(Boolean).map((r) => FRM.bookOf(r).id));
  const lastUpdate = (entry) => Math.max(0, ...entry.versions.map((v) => v.updatedAt));

  function matchesBook(entry) {
    if (filters.book === "all") return true;
    if (filters.book === NO_READING) return !entry.readings.length;
    return booksOf(entry).has(filters.book);
  }

  function visibleEntries() {
    const query = ui.fold(filters.query.trim());
    return FRM.corpusEntries().filter(
      (entry) =>
        (filters.type === "all" || entry.type === filters.type) &&
        matchesBook(entry) &&
        (filters.reading === null || entry.readings.includes(filters.reading)) &&
        (filters.author === "all" || entry.versions.some((v) => v.author === filters.author)) &&
        (!query || ui.fold(`${entry.titre} ${entry.id}`).includes(query))
    );
  }

  const SORTS = {
    titre: { label: "Titre", compare: (a, b) => a.titre.localeCompare(b.titre, "fr") },
    usage: { label: "Plus utilisées", compare: (a, b) => FRM.corpusStats.usesOf(b) - FRM.corpusStats.usesOf(a) || a.titre.localeCompare(b.titre, "fr") },
    recent: { label: "Plus récentes", compare: (a, b) => lastUpdate(b) - lastUpdate(a) },
  };

  // ------------------------------------------------------------------ list

  function entryRow(entry) {
    const refs = readingRefs(entry);
    return `
<a class="entry-row" href="${ui.entryHref(entry)}">
  ${ui.typeTag(entry.type)}
  <span class="etitle">${esc(entry.titre)} <span class="entry-id">${esc(entry.id)}</span></span>
  ${refs ? `<span class="ereadings">${esc(refs)}</span>` : ""}
  <span class="eauthors">${initialsOf(entry)}</span>
</a>`;
  }

  function renderList() {
    const list = visibleEntries();
    const total = FRM.corpusEntries().length;
    const container = document.getElementById("entries");
    document.querySelector("[data-sort]").hidden = view !== "list";
    if (!total) {
      container.innerHTML = `<div class="placeholder">Le corpus est vide pour l'instant. ${withServer ? "Crée la première entrée avec « Nouvelle entrée »." : "Il se remplit depuis l'éditeur, avec le serveur lancé."}</div>`;
      return;
    }
    if (view === "stats") return FRM.corpusStats.render(container, list);
    list.sort(SORTS[sort].compare);
    container.innerHTML = list.length
      ? `<p class="small muted">${ui.plural(list.length, "entrée")} sur ${total}</p><div class="entry-list">${list.map(entryRow).join("")}</div>`
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
    return toggles("book", [
      { value: "all", label: "Tous les livres" },
      ...FRM.books.map((b) => ({ value: b.id, label: `${b.id} · ${ui.shortTitle(b)} (${count((e) => booksOf(e).has(b.id))})`, title: b.title })),
      { value: NO_READING, label: `Sans reading (${count((e) => !e.readings.length)})`, title: "Aucune fiche ne la cite ni ne l'insère" },
    ]);
  }

  function authorFilters() {
    const authors = [...FRM.corpusStats.authorsOf(FRM.corpusEntries()).entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "fr"));
    return toggles("author", [
      { value: "all", label: "Tous les auteurs" },
      ...authors.map(([slug, a]) => ({ value: slug, label: `${a.name} (${a.initials})` })),
    ]);
  }

  function typeFilters() {
    const counts = Object.fromEntries(FRM.ENTRY_TYPES.map((t) => [t.id, 0]));
    FRM.corpusEntries().forEach((entry) => (counts[entry.type] += 1));
    return toggles("type", [
      { value: "all", label: `Tous les types (${FRM.corpusEntries().length})` },
      ...FRM.ENTRY_TYPES.map((t) => ({ value: t.id, label: `${t.plural} (${counts[t.id]})`, className: ` etype-filter etype-${t.id}` })),
    ]);
  }

  function readingSelect() {
    const groups = FRM.books.map((book) => {
      const options = book.readings.map(
        (r) => `<option value="${r.id}"${filters.reading === r.id ? " selected" : ""}>${esc(readingLabel(r))}</option>`
      );
      return `<optgroup label="${esc(`Livre ${book.id} · ${ui.shortTitle(book)}`)}">${options.join("")}</optgroup>`;
    });
    return `<select class="search" data-reading-filter aria-label="Reading"><option value="">Tous les readings</option>${groups.join("")}</select>`;
  }

  function mountList() {
    ui.mount({
      active: "corpus",
      title: "Corpus",
      trail: [{ label: "Accueil", href: "index.html" }, { label: "Corpus" }],
      body: `
<div class="card">
  <h2>Corpus</h2>
  <p>Nos formules, définitions, propriétés, théorèmes et simulations, écrits par nous. Chaque entrée a un identifiant lisible, un titre et une version par personne, signée de ses initiales. Ses readings sont ceux des fiches qui la citent ou l'insèrent.</p>
  <p class="small muted">Dans une fiche : <code>#voir("id")</code> cite une entrée (son titre), <code>#entree("id")</code> l'insère en entier. Une entrée peut en citer une autre.</p>
  <div class="save-actions">${withServer ? `<a class="btn" href="${editorHref()}">+ Nouvelle entrée</a>` : serverHint("créer ou modifier une entrée")}</div>
</div>
<div class="card">
  <div class="view-switch" role="group" aria-label="Vue">
    <button type="button" class="toggle" data-view="list" aria-pressed="${view === "list"}">Liste</button>
    <button type="button" class="toggle" data-view="stats" aria-pressed="${view === "stats"}">Stats</button>
  </div>
  <div class="filters">
    <div class="filter-group"><span class="filter-label">Type</span>${typeFilters()}</div>
    <div class="filter-group"><span class="filter-label">Livre</span>${bookFilters()}</div>
    <div class="filter-group"><span class="filter-label">Auteur</span>${authorFilters()}</div>
    <div class="filter-group">${readingSelect()}<input type="search" class="search" data-search placeholder="Titre ou identifiant…" aria-label="Rechercher">
      <select class="search" data-sort aria-label="Tri">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">Tri : ${esc(s.label)}</option>`).join("")}</select></div>
  </div>
  <div id="entries"></div>
</div>`,
    });
    renderList();

    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        view = viewButton.dataset.view;
        document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b === viewButton)));
        return renderList();
      }
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      const key = button.dataset.filter;
      const raw = button.dataset.value;
      // Book ids are numbers; every other value is a string.
      filters[key] = key === "book" && /^\d+$/.test(raw) ? Number(raw) : raw;
      document.querySelectorAll(`[data-filter="${key}"]`).forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      renderList();
    });
    document.querySelector("[data-sort]").addEventListener("change", (event) => {
      sort = event.target.value;
      renderList();
    });
    document.querySelector("[data-reading-filter]").addEventListener("change", (event) => {
      filters.reading = event.target.value ? Number(event.target.value) : null;
      renderList();
    });
    document.querySelector("[data-search]").addEventListener("input", (event) => {
      filters.query = event.target.value;
      renderList();
    });
  }

  // ------------------------------------------------------------------ one entry

  function versionBlock(entry, version, me) {
    const pages = version.pages.map(
      (path, i) => `<img class="note-page" src="${versionUrl(path, version)}" alt="${esc(`${entry.titre}, version ${version.initials}, page ${i + 1}`)}">`
    );
    const invalid = version.valid
      ? ""
      : `<span class="tag accent">Ne compile pas : absente des fiches jusqu'à correction</span>`;
    const code = version.code
      ? `<h3>Code Python</h3>${ui.codeBlock(version.code)}${FRM.runner.slot(entry, version)}`
      : "";
    return `
<div class="version">
  <div class="version-head">
    <span class="initials${version.valid ? "" : " is-invalid"}">${esc(version.initials)}</span>
    <span class="who">${esc(version.name)}${version.author === me ? " (moi)" : ""}</span>
    <span class="muted">· ${ui.dateTime(version.updatedAt)}</span>
    ${invalid}
  </div>
  ${pages.length ? `<div class="note-pages">${pages.join("")}</div>` : ""}
  ${code}
</div>`;
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
      const author = use.author.charAt(0).toUpperCase() + use.author.slice(1);
      return `<li><a href="${ui.readingHref(reading)}#notes-card">${esc(reading.tag)}</a> · fiche de ${esc(author)}</li>`;
    });
    return items.length ? `<ul>${items.join("")}</ul>` : `<p class="small muted">Aucune.</p>`;
  }

  /** AnalystPrep questions linked to the entry (from the questions page): each opens on its own. */
  function questionLinks(entry) {
    const items = (entry.questions || []).map((q) => {
      const reading = FRM.findReading(q.reading);
      if (!reading) return "";
      return `<li><a href="quiz.html?reading=${reading.id}&amp;q=${encodeURIComponent(q.id)}" title="${esc(reading.title)}">${esc(reading.tag)} · Q.${esc(q.id)}</a></li>`;
    });
    return items.length
      ? `<ul>${items.join("")}</ul>`
      : `<p class="small muted">Aucune. On lie une question depuis la page Questions (bouton 📚 Corpus sous la question).</p>`;
  }

  function mountEntry(entry) {
    const me = store.profile.authorSlug();
    const mine = entry.versions.some((v) => v.author === me);
    // The current profile's version first, then the others by name.
    const versions = [...entry.versions].sort((a, b) => (b.author === me) - (a.author === me) || a.name.localeCompare(b.name, "fr"));
    const readings = entry.readings
      .map(FRM.findReading)
      .filter(Boolean)
      .map((r) => `<a class="tag" href="${ui.readingHref(r)}" title="${esc(r.title)}">${esc(r.tag)}</a>`);
    const actions = withServer
      ? `<a class="btn" href="${editorHref(entry)}">${mine ? "✎ Modifier ma version" : "+ Ajouter ma version"}</a>`
      : serverHint("écrire ta version");

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
  <div class="entry-meta">${readings.join("") || `<span class="small muted">Aucun reading : aucune fiche ne la cite ni ne l'insère.</span>`}</div>
  <div class="snippets">
    <span>Citer : <code>#voir("${esc(entry.id)}")</code></span>
    <span>Insérer dans une fiche : <code>#entree("${esc(entry.id)}")</code></span>
  </div>
  <div class="save-actions">${actions}${(entry.questions || []).length ? `<a class="btn ghost" href="quiz.html?entries=${encodeURIComponent(entry.id)}">Série sur ses questions (${entry.questions.length})</a>` : ""}</div>
</div>
<div class="card">
  <h2>${entry.versions.length > 1 ? `${entry.versions.length} versions` : "Version"}</h2>
  ${versions.map((v) => versionBlock(entry, v, me)).join("") || `<div class="placeholder">Pas encore de version écrite.</div>`}
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
