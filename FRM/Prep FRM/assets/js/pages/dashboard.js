/* Dashboard : avancement, confiance et réussite aux questions, filtrables par livre
 * et par niveau de détail.
 *
 * Les filtres sont une seule rangée au-dessus de tout : chaque indicateur,
 * graphique et tableau se recalcule sur la même sélection. Les choix (livres,
 * détail, séries masquées, vues tableau) sont mémorisés dans ce navigateur. */
(function (FRM, ui, charts) {
  "use strict";

  const { esc } = ui;
  const { store, questions: bank } = FRM;
  const { clock } = FRM.quizView;

  // Ordre = ordre des couleurs : 1 bleu confiance, 2 orange avancement, 3 turquoise réussite.
  const SERIES = [
    { key: "confidence", label: "Confiance", className: "s-conf" },
    { key: "progress", label: "Avancement", className: "s-prog" },
    { key: "quiz", label: "Réussite", className: "s-quiz" },
  ];

  // ------------------------------------------------------------------ préférences d'affichage

  const PREFS_KEY = "frm-part1.dashboard.v1";
  const ALL_BOOKS = FRM.books.map((b) => b.id);

  function loadPrefs() {
    const defaults = { books: ALL_BOOKS, detail: "book", hidden: [], tables: [] };
    try {
      const saved = { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
      saved.books = saved.books.filter((id) => ALL_BOOKS.includes(id));
      return saved.books.length ? saved : defaults;
    } catch (e) {
      return defaults;
    }
  }

  const prefs = loadPrefs();

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      /* préférences non mémorisées : sans conséquence */
    }
  }

  const toggleIn = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  // ------------------------------------------------------------------ sélection

  const selectedBooks = () => FRM.books.filter((b) => prefs.books.includes(b.id));
  const selectedReadings = () => selectedBooks().flatMap((b) => b.readings);

  /** Unités affichées : les livres, ou les readings des livres choisis. ref + name partout. */
  function units() {
    if (prefs.detail === "book") {
      return selectedBooks().map((b) => ({ ref: `Livre ${b.id}`, name: b.title, href: ui.bookHref(b), readings: b.readings }));
    }
    return selectedReadings().map((r) => ({ ref: r.tag, name: r.title, href: ui.readingHref(r), readings: [r] }));
  }

  const measure = (unit) => ({
    ...unit,
    comp: FRM.completion(unit.readings),
    conf: FRM.confidenceOf(unit.readings),
    quiz: bank.statsOf(unit.readings),
  });
  const meanText = (conf) => (conf.mean === null ? "—" : `${ui.number(conf.mean, 1)} / 4`);
  const rateText = (rate) => (rate === null ? "—" : ui.percent(rate));

  // Deux premières colonnes de chaque vue tableau : référence, puis nom (lien).
  const NAME_COLUMNS = [{ label: "Réf.", nowrap: true }, { label: "Nom" }];
  const nameCells = (ref, name, href) => [esc(ref), `<a href="${href}">${esc(name)}</a>`];

  // ------------------------------------------------------------------ filtres

  function filters() {
    const books = FRM.books
      .map((b) => `<button type="button" class="toggle" data-filter-book="${b.id}" title="${esc(b.title)}">${b.id} · ${esc(ui.shortTitle(b))}</button>`)
      .join("");
    const details = [
      ["book", "Par livre"],
      ["reading", "Par reading"],
    ]
      .map(([value, label]) => `<button type="button" class="toggle" data-filter-detail="${value}">${label}</button>`)
      .join("");
    return `
<div class="filters">
  <div class="filter-group"><span class="filter-label">Livres</span>${books}</div>
  <div class="filter-group"><span class="filter-label">Détail</span>${details}</div>
  <button type="button" class="link-btn" data-filter-all>Tout le programme</button>
</div>`;
  }

  function syncFilters() {
    document.querySelectorAll("[data-filter-book]").forEach((b) => b.setAttribute("aria-pressed", String(prefs.books.includes(Number(b.dataset.filterBook)))));
    document.querySelectorAll("[data-filter-detail]").forEach((b) => b.setAttribute("aria-pressed", String(prefs.detail === b.dataset.filterDetail)));
  }

  // ------------------------------------------------------------------ indicateurs clés

  function kpis() {
    const books = selectedBooks();
    const list = selectedReadings();
    const comp = FRM.completion(list);
    const conf = FRM.confidenceOf(list);
    const quiz = bank.statsOf(list);
    const weightNote = books.length > 1 ? "pondéré par le poids d'examen" : ui.shortTitle(books[0]);
    const pace = quiz.avgMs === null ? "" : `${clock(quiz.avgMs)} par question · repère ${clock(bank.EXAM_PACE_MS)}`;
    const tile = (value, label, sub) =>
      `<div class="stat"><div class="num">${value}</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    return `
<div class="stat-row kpis">
  ${tile(ui.percent(FRM.weighted(books, FRM.completion)), "Avancement", `${comp.done} / ${comp.total} étapes · ${weightNote}`)}
  ${tile(ui.percent(FRM.weighted(books, FRM.confidenceOf)), "Confiance", `non noté = 0 · ${weightNote}`)}
  ${tile(meanText(conf), "Note moyenne", `sur ${conf.rated} / ${conf.total} LOs notés`)}
  ${tile(`${comp.finished} / ${comp.count}`, "Readings terminés", "4 étapes cochées")}
  ${tile(`${ui.number(quiz.seen)} / ${ui.number(quiz.total)}`, "Questions vues", `${ui.number(quiz.unseen)} jamais vues`)}
  ${tile(rateText(quiz.lastRate), "Réussite", `dernier essai · 1er essai ${rateText(quiz.firstRate)}`)}
  ${tile(ui.number(quiz.mastered), "Maîtrisées", "2 bonnes réponses de suite")}
  ${tile(ui.number(quiz.attempts), "Essais", pace)}
  ${tile(`${ui.number(quiz.treated)} / ${ui.number(quiz.total)}`, "Questions traitées", "exploitées dans les fiches")}
</div>`;
  }

  // ------------------------------------------------------------------ cartes de graphiques

  function chartCard({ id, title, subtitle, chart, tableView }) {
    const showTable = prefs.tables.includes(id);
    return `
<section class="card viz-card">
  <div class="viz-head">
    <div><h2>${title}</h2><p class="small muted">${subtitle}</p></div>
    <button type="button" class="link-btn" data-view-toggle="${id}">${showTable ? "Voir le graphique" : "Voir le tableau"}</button>
  </div>
  ${showTable ? tableView() : chart()}
</section>`;
  }

  function radarCard(measured) {
    const visible = SERIES.filter((s) => !prefs.hidden.includes(s.key));
    const axes = measured.map((u) => ({
      ref: u.ref,
      name: u.name,
      values: { confidence: u.conf.ratio, progress: u.comp.ratio, quiz: u.quiz.ratio },
      details: [
        { key: "s-conf", value: ui.percent(u.conf.ratio), label: `Confiance · ${u.conf.rated}/${u.conf.total} LOs notés` },
        { key: "s-prog", value: ui.percent(u.comp.ratio), label: `Avancement · ${u.comp.done}/${u.comp.total} étapes` },
        { key: "s-quiz", value: ui.percent(u.quiz.ratio), label: `Réussite · ${u.quiz.lastOk}/${u.quiz.total} questions justes` },
      ],
    }));
    return chartCard({
      id: "radar",
      title: "Toile : confiance, avancement, réussite",
      subtitle:
        "Confiance = somme des notes / 4 par LO. Avancement = étapes cochées. Réussite = questions justes au dernier essai. " +
        "Un LO non noté ou une question jamais vue compte 0.",
      chart: () =>
        charts.legend(
          SERIES.map((s) => ({ ...s, shape: "line", hidden: prefs.hidden.includes(s.key) })),
          { toggle: true }
        ) + charts.radar({ axes, series: visible }),
      tableView: () =>
        charts.table(
          [
            ...NAME_COLUMNS,
            { label: "Confiance", num: true },
            { label: "Note moyenne", num: true },
            { label: "Avancement", num: true },
            { label: "Étapes", num: true },
            { label: "Réussite", num: true },
            { label: "Justes", num: true },
          ],
          measured.map((u) => [
            ...nameCells(u.ref, u.name, u.href),
            ui.percent(u.conf.ratio),
            meanText(u.conf),
            ui.percent(u.comp.ratio),
            `${u.comp.done} / ${u.comp.total}`,
            ui.percent(u.quiz.ratio),
            `${u.quiz.lastOk} / ${u.quiz.total}`,
          ])
        ),
    });
  }

  function barsCard(measured) {
    return chartCard({
      id: "scores",
      title: "Répartition des notes de confiance",
      subtitle: "Part des LOs à chaque note, et note moyenne des LOs notés à droite.",
      chart: () => charts.legend(charts.scoreLegendItems()) + charts.scoreBars(measured),
      tableView: () =>
        charts.table(
          [...NAME_COLUMNS, ...FRM.SCORE_LEVELS.map((l) => ({ label: `${l.value} ${l.label}`, num: true })), { label: "Non noté", num: true }, { label: "Moyenne", num: true }],
          measured.map((u) => [...nameCells(u.ref, u.name, u.href), ...u.conf.histogram.map(String), String(u.conf.unrated), meanText(u.conf)])
        ),
    });
  }

  function mapCard() {
    const groups = selectedBooks().map((b) => ({
      title: `Livre ${b.id} · ${b.title}`,
      rows: b.readings.map((r) => ({ reading: r, steps: FRM.STEPS.map((s) => store.progress.isDone(r.id, s.id)), conf: FRM.confidenceOf([r]) })),
    }));
    const legendItems = [
      { label: "Étape faite", className: "done", shape: "rect" },
      { label: "À faire", className: "todo", shape: "rect" },
      ...charts.scoreLegendItems().map((item) => ({ ...item, label: item.key === "score-none" ? "C : non noté" : `C ${item.label}` })),
    ];
    return chartCard({
      id: "map",
      title: "Carte des étapes",
      subtitle: `Colonnes : ${ui.stepLegend()} · C = confiance moyenne (arrondie).`,
      chart: () => charts.legend(legendItems) + charts.stepMap(groups),
      tableView: () =>
        charts.table(
          [...NAME_COLUMNS, ...FRM.STEPS.map((s) => ({ label: String(s.n), num: true })), { label: "Confiance moyenne", num: true }],
          groups.flatMap((g) => g.rows).map((row) => [
            ...nameCells(row.reading.tag, row.reading.title, ui.readingHref(row.reading)),
            ...row.steps.map((done) => (done ? "✓" : "–")),
            meanText(row.conf),
          ])
        ),
    });
  }

  function weakCard() {
    const all = selectedReadings().flatMap((r) =>
      r.objectives.items.map((item, index) => ({ reading: r, index, item, score: store.confidence.get(r.id, index) }))
    );
    const weak = all.filter((x) => x.score !== null && x.score <= 1).sort((a, b) => a.score - b.score || a.reading.id - b.reading.id || a.index - b.index);
    const unrated = all.filter((x) => x.score === null).length;
    const items = weak.map(
      ({ reading, index, item, score }) => `
<li class="weak">
  <span class="score-badge score-${score}" title="${esc(FRM.SCORE_LEVELS[score].label)}">${score}</span>
  <div>
    <div class="weak-text">${esc(item.text)}</div>
    <a href="${ui.readingHref(reading)}">${esc(`${reading.tag} · ${reading.title} · LO ${index + 1}`)} · ${esc(FRM.SCORE_LEVELS[score].label)}</a>
  </div>
</li>`
    );
    return `
<section class="card viz-card">
  <div class="viz-head"><div><h2>LOs à retravailler</h2><p class="small muted">Notés 0 ou 1, du plus faible au moins faible. ${ui.plural(unrated, "LO")} de la sélection ne ${unrated > 1 ? "sont" : "est"} pas encore ${unrated > 1 ? "notés" : "noté"}.</p></div></div>
  ${items.length ? `<ol class="weak-list">${items.join("")}</ol>` : `<div class="placeholder">Aucun LO noté 0 ou 1 dans la sélection.</div>`}
</section>`;
  }

  // ------------------------------------------------------------------ questions

  /** Lien vers la page Questions, périmètre = le livre sélectionné s'il est seul. */
  function quizHref(query = "") {
    const books = selectedBooks();
    const scope = books.length === 1 ? `book=${books[0].id}` : "";
    const params = [scope, query].filter(Boolean).join("&");
    return `quiz.html${params ? `?${params}` : ""}`;
  }

  function quizCard(measured) {
    return chartCard({
      id: "quiz",
      title: "Réussite aux questions : 1er essai → dernier essai",
      subtitle: "Sur les questions déjà vues. Le trait montre le chemin parcouru entre le premier et le dernier essai ; à droite, questions vues.",
      chart: () =>
        charts.legend([
          { label: "1er essai", className: "dumb-first", shape: "dot" },
          { label: "Dernier essai", className: "s-quiz", shape: "dot" },
        ]) + charts.dumbbells(measured.map((u) => ({ ref: u.ref, name: u.name, href: u.href, stats: u.quiz }))),
      tableView: () =>
        charts.table(
          [
            ...NAME_COLUMNS,
            { label: "Vues", num: true },
            { label: "Essais", num: true },
            { label: "1er essai", num: true },
            { label: "Dernier essai", num: true },
            { label: "Maîtrisées", num: true },
            { label: "Temps moyen", num: true },
            { label: "Traitées", num: true },
          ],
          measured.map((u) => [
            ...nameCells(u.ref, u.name, u.href),
            `${u.quiz.seen} / ${u.quiz.total}`,
            String(u.quiz.attempts),
            rateText(u.quiz.firstRate),
            rateText(u.quiz.lastRate),
            String(u.quiz.mastered),
            u.quiz.avgMs === null ? "—" : clock(u.quiz.avgMs),
            `${u.quiz.treated} / ${u.quiz.total}`,
          ])
        ),
    });
  }

  /** Une entrée par série, recalculée sur les seules questions de la sélection. */
  function seriesPoints() {
    const readingIds = new Set(selectedReadings().map((r) => r.id));
    const meta = new Map(store.sessions.all().map((s) => [s.id, s]));
    const groups = new Map();
    for (const a of store.attempts.all()) {
      if (!readingIds.has(a.reading)) continue;
      const key = a.session || `jour-${new Date(a.at).toDateString()}`;
      const g = groups.get(key) || { at: a.at, n: 0, correct: 0, ms: 0, timed: 0 };
      g.at = Math.min(g.at, a.at);
      g.n += 1;
      g.correct += a.correct ? 1 : 0;
      if (a.ms !== null) {
        g.ms += a.ms;
        g.timed += 1;
      }
      groups.set(key, g);
    }
    return [...groups.entries()]
      .map(([id, g]) => {
        const s = meta.get(id);
        return { id: s ? id : null, at: g.at, n: g.n, correct: g.correct, rate: g.correct / g.n, avgMs: g.timed ? g.ms / g.timed : null, label: s ? s.label : "Série", mode: s ? s.mode : null };
      })
      .sort((a, b) => a.at - b.at);
  }

  function evolutionCard() {
    const points = seriesPoints();
    return chartCard({
      id: "evolution",
      title: "Évolution, série après série",
      subtitle: `Part de bonnes réponses dans chaque série, sur les questions de la sélection. <a href="quiz.html?exam=1">Lancer un examen blanc</a>.`,
      chart: () => charts.lineChart(points),
      tableView: () =>
        charts.table(
          [{ label: "Date", nowrap: true }, { label: "Série" }, { label: "Mode" }, { label: "Justes", num: true }, { label: "Score", num: true }, { label: "Temps / question", num: true }, { label: "" }],
          [...points].reverse().map((p) => [
            ui.dateTime(p.at),
            esc(p.label),
            p.mode === "exam" ? "Examen" : p.mode === "training" ? "Entraînement" : "—",
            `${p.correct} / ${p.n}`,
            ui.percent(p.rate),
            p.avgMs === null ? "—" : clock(p.avgMs),
            p.id ? `<a href="quiz.html?session=${encodeURIComponent(p.id)}">Revoir</a>` : "",
          ])
        ),
    });
  }

  function calibrationCard(measured) {
    const points = measured
      .filter((u) => u.conf.mean !== null && u.quiz.seen > 0)
      .map((u) => ({ ref: u.ref, name: u.name, href: u.href, x: u.conf.mean / 4, y: u.quiz.lastRate }));
    return chartCard({
      id: "calibration",
      title: "Confiance vs réussite",
      subtitle: "Un point par unité : confiance moyenne sur les LOs notés, réussite au dernier essai sur les questions vues. Sous la diagonale, tu te surestimes.",
      chart: () => charts.scatter(points),
      tableView: () =>
        charts.table(
          [...NAME_COLUMNS, { label: "Confiance", num: true }, { label: "Réussite", num: true }, { label: "Écart", num: true }],
          [...points]
            .sort((a, b) => a.y - a.x - (b.y - b.x))
            .map((p) => [...nameCells(p.ref, p.name, p.href), ui.percent(p.x), ui.percent(p.y), `${p.y >= p.x ? "+" : "−"}${Math.round(Math.abs(p.y - p.x) * 100)} pts`])
        ),
    });
  }

  function weakQuestionsCard() {
    const flaggedIds = Object.keys(store.flags.all());
    const records = selectedReadings()
      .flatMap((r) => bank.recordsOf(r.id))
      .filter((rec) => !rec.lastCorrect || flaggedIds.includes(rec.id))
      .sort((a, b) => a.lastCorrect - b.lastCorrect || b.count - b.correctCount - (a.count - a.correctCount) || a.reading - b.reading);
    const shown = records.slice(0, 30);
    const rows = shown.map((rec) => {
      const r = FRM.findReading(rec.reading);
      const last = rec.lastCorrect ? `<span class="ok-mark">✓</span>` : `<span class="ko-mark">✗</span>`;
      return `
<li class="weak-q">
  ${last}
  <div><a href="quiz.html?reading=${r.id}&q=${rec.id}">Q.${esc(rec.id)}</a> · <span class="ref-tag">${esc(r.tag)}</span> ${esc(r.title)} ${FRM.quizView.flagIcons(rec.id)}
  <div class="meta">${ui.plural(rec.count, "essai")} · ${rec.correctCount} ${rec.correctCount > 1 ? "justes" : "juste"} · dernier essai ${rec.lastCorrect ? "juste" : "faux"}</div></div>
</li>`;
    });
    return `
<section class="card viz-card">
  <div class="viz-head"><div><h2>Questions à retravailler</h2>
    <p class="small muted">Fausses au dernier essai ou marquées, les plus ratées d'abord${records.length > shown.length ? ` (30 premières sur ${records.length})` : ""}.</p></div></div>
  <div class="save-actions">
    <a class="btn" href="${quizHref("select=wrong")}">Refaire les ratées</a>
    <a class="btn ghost" href="${quizHref("select=flagged")}">Refaire les marquées</a>
    <a class="btn ghost" href="${quizHref("select=unseen")}">Jamais vues</a>
  </div>
  ${rows.length ? `<ol class="weak-list">${rows.join("")}</ol>` : `<div class="placeholder">Aucune question ratée ou marquée dans la sélection.</div>`}
</section>`;
  }

  // ------------------------------------------------------------------ rendu

  function render() {
    const active = document.activeElement;
    const focusKey = active && ["seriesToggle", "viewToggle"].find((k) => active.dataset && active.dataset[k]);
    const focusSelector = focusKey && `[data-${focusKey === "seriesToggle" ? "series-toggle" : "view-toggle"}="${active.dataset[focusKey]}"]`;

    charts.resetTips();
    const measured = units().map(measure);
    document.getElementById("dashboard").innerHTML = [
      kpis(),
      radarCard(measured),
      quizCard(measured),
      evolutionCard(),
      calibrationCard(measured),
      barsCard(measured),
      mapCard(),
      weakQuestionsCard(),
      weakCard(),
    ].join("");
    syncFilters();
    if (focusSelector) {
      const again = document.querySelector(focusSelector);
      if (again) again.focus();
    }
  }

  function update(change) {
    change();
    savePrefs();
    render();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-filter-book], [data-filter-detail], [data-filter-all], [data-series-toggle], [data-view-toggle]");
    if (!target) return;
    const { filterBook, filterDetail, seriesToggle, viewToggle } = target.dataset;

    if (filterBook) {
      const books = toggleIn(prefs.books, Number(filterBook));
      if (!books.length) return ui.flash("Garde au moins un livre sélectionné.");
      update(() => (prefs.books = FRM.books.map((b) => b.id).filter((id) => books.includes(id))));
    } else if (filterDetail) {
      update(() => (prefs.detail = filterDetail));
    } else if (target.hasAttribute("data-filter-all")) {
      update(() => (prefs.books = ALL_BOOKS));
    } else if (seriesToggle) {
      const hidden = toggleIn(prefs.hidden, seriesToggle);
      if (hidden.length === SERIES.length) return ui.flash("Garde au moins une série affichée.");
      update(() => (prefs.hidden = hidden));
    } else if (viewToggle) {
      update(() => (prefs.tables = toggleIn(prefs.tables, viewToggle)));
    }
  });

  ui.mount({
    active: "dashboard",
    title: "Dashboard",
    trail: [{ label: "Accueil", href: "index.html" }, { label: "Dashboard" }],
    body: `${filters()}<div id="dashboard"></div>`,
  });
  render();
  document.addEventListener("frm:change", render); // import ou modification depuis un autre onglet
})(window.FRM, window.FRM.ui, window.FRM.charts);
