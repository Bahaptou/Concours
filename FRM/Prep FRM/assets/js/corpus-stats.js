/* Corpus statistics ("Stats" view of corpus.html): headline tiles, things to watch, entries by
 * type, most used entries, the most complex code (bricks used), and a sortable table. Works on the list
 * filtered by the page. Bars and tooltips come from charts.js (no library). Colours follow the
 * dataviz skill: type colours for type identity only; the kinds of use (fiches, questions,
 * citations) are a one-hue slate ramp validated with its script (--ordinal, light #ffffff and
 * dark #1b2238), so that they never read as a type. */
(function (FRM, ui, charts) {
  "use strict";

  const { esc } = ui;

  /** How much an entry is used: entries citing it plus notes citing or inserting it (list sort). */
  const usesOf = (entry) => (entry.citedBy || []).length + (entry.usedBy || []).length;

  /** {author slug: { initials, name, valid, invalid }} over the versions of the entries. */
  function authorsOf(entries) {
    const authors = new Map();
    for (const entry of entries) {
      for (const v of entry.versions) {
        const a = authors.get(v.author) || { initials: v.initials, name: v.name, valid: 0, invalid: 0 };
        a[v.valid ? "valid" : "invalid"] += 1;
        authors.set(v.author, a);
      }
    }
    return authors;
  }

  // ------------------------------------------------------------------ tiles

  function tiles(entries) {
    const versions = entries.reduce((sum, e) => sum + e.versions.length, 0);
    const links = entries.reduce((sum, e) => sum + e.cites.length + (e.usedBy || []).length, 0);
    const readings = new Set(entries.flatMap((e) => e.readings));
    const questions = new Set(entries.flatMap((e) => (e.questions || []).map((q) => q.id)));
    const tile = (value, label, sub) =>
      `<div class="stat"><div class="num">${ui.number(value)}</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    return `<div class="stat-row">
  ${tile(entries.length, "Entrées", `${ui.plural(versions, "version")}`)}
  ${tile(links, "Liens", "citations entre entrées et usages en fiche")}
  ${tile(questions.size, "Questions liées", "questions AnalystPrep reliées")}
  ${tile(readings.size, "Readings", `sur ${FRM.readings.length}, via les fiches`)}
</div>`;
  }

  // ------------------------------------------------------------------ things to watch

  function watchList(entries) {
    const groups = [
      { label: "Sans reading : aucune fiche ne la cite ni ne l'insère", list: entries.filter((e) => !e.readings.length) },
      { label: "Une version ne compile pas : absente des fiches", list: entries.filter((e) => e.versions.some((v) => !v.valid)) },
      { label: "Aucune version écrite", list: entries.filter((e) => !e.versions.length) },
    ];
    const link = (e) => `<a href="${ui.entryHref(e)}">${esc(e.titre)}</a>`;
    const items = groups.map((g) => {
      const shown = g.list.slice(0, 8).map(link).join(", ");
      const more = g.list.length > 8 ? ` et ${g.list.length - 8} autres` : "";
      const mark = g.list.length ? "⚠" : "✓";
      return `<li class="watch-item"><span class="watch-mark" aria-hidden="true">${mark}</span><div><strong>${ui.number(g.list.length)}</strong> · ${esc(g.label)}${g.list.length ? `<div class="small">${shown}${more}</div>` : ""}</div></li>`;
    });
    return `<ul class="watch-list">${items.join("")}</ul>`;
  }

  // ------------------------------------------------------------------ bars

  /** Horizontal magnitude bars on a shared scale.
   *  rows : [{ label (HTML), title, segments: [{ n, className, tipLabel }], value }] */
  function bars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.segments.reduce((sum, s) => sum + s.n, 0)));
    const line = (row) => {
      const segments = row.segments
        .filter((s) => s.n > 0)
        .map((s) => {
          const id = charts.tip({ title: row.title, rows: [{ key: s.className, value: ui.number(s.n), label: s.tipLabel }] });
          return `<span class="seg ${s.className}" style="flex:0 0 ${(s.n / max) * 100}%" data-tip="${id}" tabindex="0" aria-label="${esc(`${row.title} : ${s.n} ${s.tipLabel}`)}"></span>`;
        });
      return `
<div class="bar-row">
  <span class="bar-label" title="${esc(row.title)}">${row.label}</span>
  <div class="stack">${segments.join("")}</div>
  <span class="bar-value">${row.value}</span>
</div>`;
    };
    return `<div class="bars">${rows.map(line).join("")}</div>`;
  }

  function byType(entries) {
    return bars(
      FRM.ENTRY_TYPES.map((t) => {
        const n = entries.filter((e) => e.type === t.id).length;
        return {
          label: `${ui.typeTag(t.id)}`,
          title: t.plural,
          segments: [{ n, className: `etype-bar etype-${t.id}`, tipLabel: n > 1 ? "entrées" : "entrée" }],
          value: ui.number(n),
        };
      })
    );
  }

  // ------------------------------------------------------------------ most used (series toggled from the legend)

  const USE_SERIES = [
    { key: "notes", label: "dans des fiches", tip: "fiches qui la citent ou l'insèrent", count: (e) => (e.usedBy || []).length },
    { key: "questions", label: "questions liées", tip: "questions liées", count: (e) => (e.questions || []).length },
    { key: "citedBy", label: "citée par des entrées", tip: "entrées qui la citent", count: (e) => (e.citedBy || []).length },
    { key: "cites", label: "cite d'autres entrées", tip: "entrées qu'elle cite", count: (e) => (e.cites || []).length },
  ];
  const shownSeries = new Set(USE_SERIES.map((s) => s.key)); // kept while the page is open
  let lastEntries = [];

  function mostUsedLegend() {
    const item = (s) =>
      `<button type="button" class="legend-item" data-use-series="${s.key}" aria-pressed="${shownSeries.has(s.key)}" title="${shownSeries.has(s.key) && shownSeries.size === 1 ? "Au moins une série reste affichée" : "Afficher ou masquer"}"><span class="key rect use-bar use-${s.key}"></span>${esc(s.label)}</button>`;
    return `<div class="legend">${USE_SERIES.map(item).join("")}</div>`;
  }

  function mostUsedBars(entries) {
    const series = USE_SERIES.filter((s) => shownSeries.has(s.key));
    const total = (e) => series.reduce((sum, s) => sum + s.count(e), 0);
    const top = entries.filter((e) => total(e) > 0).sort((a, b) => total(b) - total(a) || a.titre.localeCompare(b.titre, "fr")).slice(0, 8);
    if (!top.length) return `<div class="placeholder">Aucune entrée pour les séries affichées.</div>`;
    return bars(
      top.map((e) => ({
        label: `<a href="${ui.entryHref(e)}">${esc(e.titre)}</a>`,
        title: e.titre,
        segments: series.map((s) => ({ n: s.count(e), className: `use-bar use-${s.key}`, tipLabel: s.tip })),
        value: ui.number(total(e)),
      }))
    );
  }

  function mostUsed(entries) {
    return `<div data-most-used>${mostUsedLegend()}${mostUsedBars(entries)}</div>`;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-use-series]");
    if (!button) return;
    const key = button.dataset.useSeries;
    if (shownSeries.has(key)) {
      if (shownSeries.size === 1) return; // at least one bar stays
      shownSeries.delete(key);
    } else {
      shownSeries.add(key);
    }
    const box = button.closest("[data-most-used]");
    box.innerHTML = `${mostUsedLegend()}${mostUsedBars(lastEntries)}`;
    box.querySelector(`[data-use-series="${key}"]`).focus();
  });

  // ------------------------------------------------------------------ most complex simulations

  /** Bricks a code uses: imported directly, and those imported by these bricks, transitively. */
  function bricksOf(entry) {
    const direct = new Set(entry.imports || []);
    const all = new Set();
    const visit = (id) => {
      if (all.has(id) || id === entry.id) return;
      all.add(id);
      (FRM.findEntry(id)?.imports || []).forEach(visit);
    };
    direct.forEach(visit);
    return { direct, indirect: [...all].filter((id) => !direct.has(id)) };
  }

  /** Simulations and bricks ranked by the number of bricks they use (code that imports nothing is left out). */
  function complexCode(entries) {
    const sims = entries
      .filter((e) => e.type === "simulation" || e.type === "brique")
      .map((e) => ({ entry: e, ...bricksOf(e) }))
      .filter((s) => s.direct.size + s.indirect.length > 0)
      .sort((a, b) => b.direct.size + b.indirect.length - (a.direct.size + a.indirect.length) || a.entry.titre.localeCompare(b.entry.titre, "fr"))
      .slice(0, 8);
    if (!sims.length) return `<div class="placeholder">Aucun code (simulation ou brique) n'importe encore de brique.</div>`;
    const names = (ids) => [...ids].map((id) => FRM.findEntry(id)?.titre || id).join(", ");
    return `
<div class="legend"><span class="legend-item"><span class="key rect brick-direct"></span>briques importées</span><span class="legend-item"><span class="key rect brick-indirect"></span>via d'autres briques</span></div>
${bars(
  sims.map((s) => ({
    // A type dot, not the full tag: the label column is narrow, the title must stay readable.
    label: `<span class="type-dot etype-${s.entry.type}" title="${esc(FRM.entryType(s.entry.type).label)}"></span><a href="${ui.entryHref(s.entry)}">${esc(s.entry.titre)}</a>`,
    title: s.entry.titre,
    segments: [
      // The brick type's colour (they are bricks); hatched when reached through another brick.
      { n: s.direct.size, className: "brick-direct", tipLabel: `importées : ${names(s.direct)}` },
      { n: s.indirect.length, className: "brick-indirect", tipLabel: `via d'autres briques : ${names(s.indirect)}` },
    ],
    value: ui.plural(s.direct.size + s.indirect.length, "brique"),
  }))
)}`;
  }

  // ------------------------------------------------------------------ table view (sortable)

  const COLUMNS = [
    { key: "titre", label: "Entrée", value: (e) => e.titre, cell: (e) => `<a href="${ui.entryHref(e)}">${esc(e.titre)}</a>` },
    { key: "type", label: "Type", value: (e) => FRM.ENTRY_TYPES.findIndex((t) => t.id === e.type), cell: (e) => ui.typeTag(e.type), nowrap: true },
    {
      key: "versions",
      label: "Versions",
      value: (e) => e.versions.length,
      cell: (e) => e.versions.map((v) => `<span class="initials${v.valid ? "" : " is-invalid"}" title="${esc(v.name)}">${esc(v.initials)}</span>`).join("") || "—",
    },
    {
      key: "readings",
      label: "Readings",
      value: (e) => e.readings.length,
      cell: (e) => e.readings.map((r) => esc(FRM.findReading(r)?.tag || `R${r}`)).join(", ") || `<span class="muted">—</span>`,
    },
    { key: "notes", label: "Fiches", num: true, value: (e) => (e.usedBy || []).length },
    { key: "questions", label: "Questions", num: true, value: (e) => (e.questions || []).length },
    { key: "citedBy", label: "Citée par", num: true, value: (e) => (e.citedBy || []).length },
    { key: "cites", label: "Cite", num: true, value: (e) => (e.cites || []).length },
  ];
  const sort = { key: "notes", dir: -1 }; // kept while the page is open

  function sortedRows(entries) {
    const column = COLUMNS.find((c) => c.key === sort.key);
    const compare = (a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      const order = typeof x === "string" ? x.localeCompare(y, "fr") : x - y;
      return order * sort.dir || a.titre.localeCompare(b.titre, "fr");
    };
    return [...entries].sort(compare);
  }

  function tableBody(entries) {
    const cell = (c, e) => {
      if (c.cell) return c.cell(e);
      const n = c.value(e);
      return n ? ui.number(n) : `<span class="muted">0</span>`;
    };
    return sortedRows(entries)
      .map((e) => `<tr class="etype-row etype-${e.type}">${COLUMNS.map((c) => `<td${c.num ? ' class="num"' : c.nowrap ? ' class="nowrap"' : ""}>${cell(c, e)}</td>`).join("")}</tr>`)
      .join("");
  }

  function tableHead() {
    return COLUMNS.map((c) => {
      const active = c.key === sort.key;
      const arrow = active ? (sort.dir > 0 ? " ▲" : " ▼") : "";
      const aria = active ? (sort.dir > 0 ? "ascending" : "descending") : "none";
      return `<th class="${c.num ? "num" : ""}" aria-sort="${aria}"><button type="button" class="th-sort" data-sort-col="${c.key}">${esc(c.label)}<span class="sort-arrow">${arrow}</span></button></th>`;
    }).join("");
  }

  function tableView(entries) {
    return `<div class="table-wrap"><table class="data sortable" data-corpus-table><thead><tr>${tableHead()}</tr></thead><tbody>${tableBody(entries)}</tbody></table></div>`;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort-col]");
    if (!button) return;
    const key = button.dataset.sortCol;
    const column = COLUMNS.find((c) => c.key === key);
    // Same column: reverse. New column: numbers from the largest, text from A.
    sort.dir = sort.key === key ? -sort.dir : column.num || key === "versions" || key === "readings" ? -1 : 1;
    sort.key = key;
    const table = button.closest("[data-corpus-table]");
    table.querySelector("thead tr").innerHTML = tableHead();
    table.querySelector("tbody").innerHTML = tableBody(lastEntries);
    table.querySelector(`[data-sort-col="${key}"]`).focus();
  });

  // ------------------------------------------------------------------ view

  function render(container, entries) {
    charts.resetTips();
    lastEntries = entries;
    if (!entries.length) {
      container.innerHTML = `<div class="placeholder">Aucune entrée ne correspond à ces filtres.</div>`;
      return;
    }
    container.innerHTML = `
${tiles(entries)}
<div class="stats-grid">
  <section><h3>À surveiller</h3>${watchList(entries)}</section>
  <section><h3>Entrées par type</h3>${byType(entries)}</section>
  <section><h3>Les plus utilisées</h3><p class="small muted">Clique sur la légende pour choisir ce qui compte.</p>${mostUsed(entries)}</section>
  <section><h3>Code le plus complexe</h3><p class="small muted">Simulations et briques, par nombre de briques utilisées, directement ou à travers d'autres briques.</p>${complexCode(entries)}</section>
</div>
<details class="q-table-toggle"><summary>Voir en tableau (${entries.length})</summary><p class="small muted">Clique sur un en-tête pour trier.</p>${tableView(entries)}</details>
<p class="src">Calculé sur les entrées affichées par les filtres. Readings et usages viennent des fiches (<code>#voir</code>, <code>#entree</code>) ; les questions, des liens posés depuis la page Questions.</p>`;
  }

  FRM.corpusStats = { render, authorsOf, usesOf };
})(window.FRM, window.FRM.ui, window.FRM.charts);
