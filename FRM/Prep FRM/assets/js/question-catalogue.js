/* Question catalogue ("Catalogue" tab of quiz.html): every AnalystPrep question of a scope, with
 * its own figures (attempts, right answers, last result, time, series it was in, marks, corpus
 * links), filtered, searched and sorted. One line per question, opening its page (question.html).
 * Totals by book or reading are the dashboard's job, not repeated here. Works without the server. */
(function (FRM, ui, view) {
  "use strict";

  const { esc, fold } = ui;
  const { store } = FRM;
  const bank = FRM.questions;
  const PAGE = 100;

  // ------------------------------------------------------------------ state (kept while the page is open)

  const state = { scope: "all", filter: "all", query: "", sort: { key: "question", dir: 1 }, limit: PAGE };

  const FILTERS = [
    { id: "all", label: "Toutes", keep: () => true },
    { id: "unseen", label: "Jamais faites", keep: (row) => !row.record },
    { id: "wrong", label: "Ratées au dernier essai", keep: (row) => row.record && !row.record.lastCorrect },
    { id: "right", label: "Réussies au dernier essai", keep: (row) => row.record && row.record.lastCorrect },
    { id: "flagged", label: "Marquées 🚩 ⚠", keep: (row) => bank.isFlagged(row.question) },
    { id: "treated", label: "Traitées", keep: (row) => store.treated.has(row.question.id) },
    { id: "untreated", label: "Non traitées", keep: (row) => !store.treated.has(row.question.id) },
    { id: "linked", label: "Liées au corpus", keep: (row) => row.entries.length > 0 },
    { id: "unlinked", label: "Non liées", keep: (row) => !row.entries.length },
  ];

  // ------------------------------------------------------------------ rows

  const textOf = (blocks) => blocks.map((b) => b.text).join(" ");

  /** Corpus entries linked to each question, from the corpus manifest. */
  function linksByQuestion() {
    const links = new Map();
    for (const entry of FRM.corpusEntries()) {
      for (const q of entry.questions || []) {
        if (!links.has(q.id)) links.set(q.id, []);
        links.get(q.id).push(entry);
      }
    }
    return links;
  }

  function rowsOf(questions) {
    const links = linksByQuestion();
    return questions.map((question, order) => {
      const record = bank.recordOf(question.id);
      const series = record ? new Set(record.attempts.map((a) => a.session).filter(Boolean)).size : 0;
      return {
        question,
        order,
        record,
        series,
        entries: links.get(question.id) || [],
        search: fold(`${question.id} ${textOf(question.stem)} ${["A", "B", "C", "D"].map((l) => textOf(question.options[l] || [])).join(" ")}`),
      };
    });
  }

  const COLUMNS = [
    { key: "question", label: "Question", value: (r) => r.order },
    { key: "stem", label: "Énoncé", value: (r) => fold(textOf(r.question.stem)) },
    { key: "count", label: "Faite", num: true, value: (r) => (r.record ? r.record.count : 0), first: -1 },
    { key: "right", label: "Justes", num: true, value: (r) => (r.record ? r.record.correctCount : -1), first: -1 },
    { key: "rate", label: "Réussite", num: true, value: (r) => (r.record ? r.record.correctCount / r.record.count : -1), first: -1 },
    { key: "last", label: "Dernier", num: true, value: (r) => (r.record ? (r.record.lastCorrect ? 1 : 0) : -1), first: -1 },
    { key: "time", label: "Temps moyen", num: true, value: (r) => (r.record && r.record.timedCount ? r.record.totalMs / r.record.timedCount : -1), first: -1 },
    { key: "series", label: "Séries", num: true, value: (r) => r.series, first: -1 },
    { key: "marks", label: "Marques", value: (r) => (store.treated.has(r.question.id) ? 1 : 0) + (bank.isFlagged(r.question) ? 2 : 0) + r.entries.length * 4, first: -1 },
    { key: "when", label: "Dernière fois", num: true, value: (r) => (r.record ? r.record.lastAt : 0), first: -1 },
  ];

  function sorted(rows) {
    const column = COLUMNS.find((c) => c.key === state.sort.key);
    return [...rows].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      const order = typeof x === "string" ? x.localeCompare(y, "fr") : x - y;
      return order * state.sort.dir || a.order - b.order;
    });
  }

  // ------------------------------------------------------------------ rendering

  const questionHref = (q) => `question.html?reading=${q.reading}&amp;q=${encodeURIComponent(q.id)}`;
  const mark = (ok) => (ok ? `<span class="ok-mark">✓</span>` : `<span class="ko-mark">✗</span>`);

  function rowHtml(row) {
    const { question: q, record: r } = row;
    const reading = FRM.findReading(q.reading);
    const stem = textOf(q.stem);
    const snippet = stem.length > 90 ? `${stem.slice(0, 90)}…` : stem;
    const avg = r && r.timedCount ? view.clock(r.totalMs / r.timedCount) : "—";
    const corpus = row.entries.length
      ? ` <span class="cat-links" title="${esc(row.entries.map((e) => e.titre).join(", "))}">📚 ${row.entries.length}</span>`
      : "";
    return `<tr>
  <td class="nowrap"><a href="${questionHref(q)}"><span class="ref-tag">${esc(reading.tag)}</span> Q.${esc(q.id)}</a></td>
  <td class="cat-stem"><a href="${questionHref(q)}">${esc(snippet)}</a></td>
  <td class="num">${r ? r.count : `<span class="muted">0</span>`}</td>
  <td class="num">${r ? r.correctCount : "—"}</td>
  <td class="num">${r ? ui.percent(r.correctCount / r.count) : "—"}</td>
  <td class="num">${r ? mark(r.lastCorrect) : "—"}</td>
  <td class="num">${avg}</td>
  <td class="num">${r ? row.series : "—"}</td>
  <td class="nowrap">${view.flagIcons(q.id)}${corpus}</td>
  <td class="num nowrap" title="${r ? esc(ui.dateTime(r.lastAt)) : ""}">${r ? new Date(r.lastAt).toLocaleDateString("fr-FR") : "—"}</td>
</tr>`;
  }

  function scopeSelect() {
    const option = (value, label) => `<option value="${value}"${value === state.scope ? " selected" : ""}>${esc(label)}</option>`;
    const books = FRM.books.map((b) => option(`book:${b.id}`, `Livre ${b.id} · ${b.title}`)).join("");
    const readings = FRM.books
      .map((b) => `<optgroup label="${esc(`Livre ${b.id} · ${b.title}`)}">${b.readings.map((r) => option(`reading:${r.id}`, `${r.tag} · ${r.title}`)).join("")}</optgroup>`)
      .join("");
    return `<select class="search" data-cat-scope aria-label="Périmètre">${option("all", "Tout le programme")}<optgroup label="Livres entiers">${books}</optgroup>${readings}</select>`;
  }

  function filterButtons() {
    return FILTERS.map((f) => `<button type="button" class="toggle small" data-cat-filter="${f.id}" aria-pressed="${state.filter === f.id}">${esc(f.label)}</button>`).join("");
  }

  function head() {
    return COLUMNS.map((c) => {
      const active = c.key === state.sort.key;
      const arrow = active ? (state.sort.dir > 0 ? " ▲" : " ▼") : "";
      return `<th class="${c.num ? "num" : ""}" aria-sort="${active ? (state.sort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="th-sort" data-cat-sort="${c.key}">${esc(c.label)}<span class="sort-arrow">${arrow}</span></button></th>`;
    }).join("");
  }

  let allRows = [];
  let box = null;

  function renderTable() {
    const query = fold(state.query.trim());
    const filter = FILTERS.find((f) => f.id === state.filter);
    const shown = sorted(allRows.filter((row) => filter.keep(row) && (!query || row.search.includes(query))));
    const page = shown.slice(0, state.limit);
    box.querySelector("[data-cat-count]").textContent = `${ui.plural(shown.length, "question")}${shown.length !== allRows.length ? ` sur ${ui.number(allRows.length)}` : ""}`;
    box.querySelector("[data-cat-table]").innerHTML = shown.length
      ? `<div class="table-wrap"><table class="data sortable cat-table"><thead><tr>${head()}</tr></thead><tbody>${page.map(rowHtml).join("")}</tbody></table></div>
        ${shown.length > page.length ? `<div class="save-actions"><button type="button" class="btn ghost" data-cat-more>Afficher ${Math.min(PAGE, shown.length - page.length)} de plus (${shown.length - page.length} restantes)</button></div>` : ""}`
      : `<div class="placeholder">Aucune question ne correspond.</div>`;
  }

  async function loadScope() {
    box.querySelector("[data-cat-count]").textContent = "Chargement…";
    const ids = scopeReadingIds(state.scope);
    const questions = await bank.load(ids);
    allRows = rowsOf(questions);
    state.limit = PAGE;
    renderTable();
  }

  function scopeReadingIds(scope) {
    const [kind, id] = scope.split(":");
    if (kind === "book") return FRM.findBook(id).readings.map((r) => r.id);
    if (kind === "reading") return [Number(id)];
    return FRM.readings.map((r) => r.id);
  }

  /** Fills `container`. initial: { scope } from the address (quiz.html?vue=catalogue&reading=12). */
  function render(container, initial = {}) {
    if (initial.scope) state.scope = initial.scope;
    box = container;
    container.innerHTML = `
<div class="card">
  <h2>Catalogue des questions</h2>
  <p class="small muted">Chaque question avec ses propres chiffres ; un clic ouvre sa page (énoncé, correction, marques, liens au corpus, historique) sans lancer de série.</p>
  <div class="filters">
    <div class="filter-group">${scopeSelect()}<input type="search" class="search" data-cat-search placeholder="Chercher dans l'énoncé, les réponses, le numéro…" aria-label="Chercher" value="${esc(state.query)}"></div>
    <div class="filter-group">${filterButtons()}</div>
  </div>
  <p class="small"><strong data-cat-count></strong></p>
  <div data-cat-table></div>
</div>`;
    loadScope();
  }

  // ------------------------------------------------------------------ events

  document.addEventListener("click", (event) => {
    if (!box || !box.contains(event.target)) return;
    const filter = event.target.closest("[data-cat-filter]");
    if (filter) {
      state.filter = filter.dataset.catFilter;
      state.limit = PAGE;
      box.querySelectorAll("[data-cat-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === filter)));
      return renderTable();
    }
    const sort = event.target.closest("[data-cat-sort]");
    if (sort) {
      const key = sort.dataset.catSort;
      const column = COLUMNS.find((c) => c.key === key);
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : column.first || 1 };
      renderTable();
      return box.querySelector(`[data-cat-sort="${key}"]`).focus();
    }
    if (event.target.closest("[data-cat-more]")) {
      state.limit += PAGE;
      renderTable();
    }
  });

  document.addEventListener("change", (event) => {
    if (box && event.target.matches("[data-cat-scope]")) {
      state.scope = event.target.value;
      loadScope();
    }
  });

  let searchTimer = null;
  document.addEventListener("input", (event) => {
    if (!box || !event.target.matches("[data-cat-search]")) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = event.target.value;
      state.limit = PAGE;
      renderTable();
    }, 150);
  });

  FRM.questionCatalogue = { render };
})(window.FRM, window.FRM.ui, window.FRM.quizView);
