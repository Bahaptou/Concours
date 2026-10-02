/* Corpus statistics ("Stats" view of corpus.html): headline tiles, things to watch, entries by
 * type, versions by author, most used entries, and the same data as a table. Works on the list
 * filtered by the page. Bars and tooltips come from charts.js (no library); colours follow the
 * dataviz skill: type colours for type identity only, a neutral fill for single-series counts. */
(function (FRM, ui, charts) {
  "use strict";

  const { esc } = ui;

  /** How much an entry is used: entries citing it plus notes citing or inserting it. */
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
    const tile = (value, label, sub) =>
      `<div class="stat"><div class="num">${ui.number(value)}</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    return `<div class="stat-row">
  ${tile(entries.length, "Entrées", `${ui.plural(versions, "version")}`)}
  ${tile(authorsOf(entries).size, "Auteurs", "au moins une version")}
  ${tile(links, "Liens", "citations entre entrées et usages en fiche")}
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

  function byAuthor(entries) {
    const authors = [...authorsOf(entries).values()].sort((a, b) => b.valid + b.invalid - (a.valid + a.invalid) || a.name.localeCompare(b.name, "fr"));
    if (!authors.length) return `<div class="placeholder">Aucune version écrite.</div>`;
    return bars(
      authors.map((a) => ({
        label: `<span class="initials">${esc(a.initials)}</span> ${esc(a.name)}`,
        title: a.name,
        segments: [
          { n: a.valid, className: "count-bar", tipLabel: "versions qui compilent" },
          { n: a.invalid, className: "invalid-bar", tipLabel: "versions qui ne compilent pas" },
        ],
        value: `${ui.number(a.valid + a.invalid)}${a.invalid ? ` <span class="small">dont ${a.invalid} ⚠</span>` : ""}`,
      }))
    );
  }

  function mostUsed(entries) {
    const top = entries.filter((e) => usesOf(e) > 0).sort((a, b) => usesOf(b) - usesOf(a) || a.titre.localeCompare(b.titre, "fr")).slice(0, 8);
    if (!top.length) return `<div class="placeholder">Aucune entrée n'est encore citée ni utilisée dans une fiche.</div>`;
    return bars(
      top.map((e) => ({
        label: `<a href="${ui.entryHref(e)}">${esc(e.titre)}</a>`,
        title: e.titre,
        segments: [
          { n: (e.usedBy || []).length, className: "count-bar", tipLabel: "fiches qui la citent ou l'insèrent" },
          { n: (e.citedBy || []).length, className: "count-bar-alt", tipLabel: "entrées qui la citent" },
        ],
        value: ui.number(usesOf(e)),
      }))
    );
  }

  // ------------------------------------------------------------------ table view

  function tableView(entries) {
    const columns = [
      { label: "Entrée" }, { label: "Type", nowrap: true }, { label: "Versions" }, { label: "Readings" },
      { label: "Citée par", num: true }, { label: "Fiches", num: true },
    ];
    const rows = entries.map((e) => [
      `<a href="${ui.entryHref(e)}">${esc(e.titre)}</a>`,
      esc(FRM.entryType(e.type).label),
      e.versions.map((v) => `${esc(v.initials)}${v.valid ? "" : " ⚠"}`).join(", ") || "—",
      e.readings.map((r) => esc(FRM.findReading(r)?.tag || `R${r}`)).join(", ") || "—",
      ui.number((e.citedBy || []).length),
      ui.number((e.usedBy || []).length),
    ]);
    return charts.table(columns, rows);
  }

  // ------------------------------------------------------------------ view

  function render(container, entries) {
    charts.resetTips();
    if (!entries.length) {
      container.innerHTML = `<div class="placeholder">Aucune entrée ne correspond à ces filtres.</div>`;
      return;
    }
    container.innerHTML = `
${tiles(entries)}
<div class="stats-grid">
  <section><h3>À surveiller</h3>${watchList(entries)}</section>
  <section><h3>Entrées par type</h3>${byType(entries)}</section>
  <section><h3>Versions par auteur</h3>${byAuthor(entries)}</section>
  <section>
    <h3>Les plus utilisées</h3>
    <div class="legend"><span class="legend-item"><span class="key rect count-bar"></span>dans des fiches</span><span class="legend-item"><span class="key rect count-bar-alt"></span>par d'autres entrées</span></div>
    ${mostUsed(entries)}
  </section>
</div>
<details class="q-table-toggle"><summary>Voir en tableau (${entries.length})</summary>${tableView(entries)}</details>
<p class="src">Calculé sur les entrées affichées par les filtres. Readings et usages viennent des fiches (<code>#voir</code>, <code>#entree</code>).</p>`;
  }

  FRM.corpusStats = { render, authorsOf, usesOf };
})(window.FRM, window.FRM.ui, window.FRM.charts);
