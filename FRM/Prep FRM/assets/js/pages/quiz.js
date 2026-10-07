/* Page Questions (quiz.html) : réglage d'une série, déroulé, bilan.
 *
 * Deux modes : entraînement (correction après chaque question, réponse enregistrée
 * à la validation) et examen (correction à la fin, réponses enregistrées à la fin,
 * compte à rebours possible au rythme de l'examen). La série en cours est
 * sauvegardée à chaque action et se reprend après un rechargement.
 *
 * Adresse : ?reading=12 ou ?book=2 (périmètre pré-rempli), &select=unseen|wrong|flagged|untreated,
 *           &q=315 (s'entraîner sur cette seule question, tout de suite), ?exam=1 (réglages d'examen
 *           blanc), ?session=s… (revoir le bilan d'une série terminée), ?vue=catalogue (onglet
 *           Catalogue, question-catalogue.js ; &reading=12 ou &book=2 pour son périmètre).
 * Voir une question sans lancer de série : question.html (page Question). */
(function (FRM, ui, view) {
  "use strict";

  const { esc } = ui;
  const { store, questions: bank } = FRM;
  const params = new URLSearchParams(window.location.search);

  const COUNTS = [null, 10, 20, 50, 100];
  const EXAM_PRESET = { scope: "all", selection: "all", count: 100, order: "random", mode: "exam", countdown: true, weighted: true, label: "Examen blanc" };

  let session = null; // série en cours, miroir de store.activeSession
  let byId = new Map(); // questions de la série en cours
  let shownAt = null; // début d'affichage de la question courante (null : chrono arrêté)
  let clockTimer = null;
  let summary = null; // dernier bilan affiché
  let screen = "setup";

  const root = () => document.getElementById("quiz");

  // ------------------------------------------------------------------ périmètres et libellés

  // Scope "entries": the questions linked to corpus entries (stored in the corpus, read from its
  // manifest). match "any": linked to at least one of the chosen entries; "all": to every one.
  const ENTRIES_SCOPE = "entries";
  const linkedEntries = () => FRM.corpusEntries().filter((entry) => (entry.questions || []).length);

  /** Questions (id -> reading) of the chosen entries, combined by `match`. */
  function entryQuestions({ entries = [], match = "any" }) {
    const lists = entries.map(FRM.findEntry).filter(Boolean).map((entry) => entry.questions || []);
    if (!lists.length) return new Map();
    const counts = new Map();
    const readingOf = new Map();
    for (const list of lists) {
      for (const q of new Map(list.map((item) => [item.id, item])).values()) {
        counts.set(q.id, (counts.get(q.id) || 0) + 1);
        readingOf.set(q.id, q.reading);
      }
    }
    const kept = [...counts].filter(([, n]) => (match === "all" ? n === lists.length : true)).map(([id]) => [id, readingOf.get(id)]);
    return new Map(kept);
  }

  function scopeReadings(scope, scopeOptions = options) {
    const [kind, id] = scope.split(":");
    if (kind === "book") return FRM.findBook(id).readings;
    if (kind === "reading") return [FRM.findReading(id)];
    if (kind === ENTRIES_SCOPE) return [...new Set(entryQuestions(scopeOptions).values())].map(FRM.findReading).filter(Boolean);
    return FRM.readings;
  }

  /** Questions of a scope: the readings' banks, narrowed to the linked questions for "entries". */
  async function scopePool(scopeOptions) {
    const pool = await bank.load(scopeReadings(scopeOptions.scope, scopeOptions).map((r) => r.id));
    if (scopeOptions.scope !== ENTRIES_SCOPE) return pool;
    const wanted = entryQuestions(scopeOptions);
    return pool.filter((q) => wanted.has(q.id));
  }

  function scopeLabel(scope, scopeOptions = options) {
    const [kind, id] = scope.split(":");
    if (kind === "book") return `Livre ${id} · ${FRM.findBook(id).title}`;
    if (kind === "reading") return `${FRM.findReading(id).tag} · ${FRM.findReading(id).title}`;
    if (kind === ENTRIES_SCOPE) {
      const titles = (scopeOptions.entries || []).map(FRM.findEntry).filter(Boolean).map((entry) => entry.titre);
      return `Corpus · ${titles.join(scopeOptions.match === "all" ? " ∩ " : " ∪ ")}`;
    }
    return "Tout le programme";
  }

  function describe(options) {
    if (options.label) return options.label;
    const selection = bank.SELECTIONS.find((s) => s.id === options.selection);
    return [scopeLabel(options.scope, options), selection.id !== "all" && selection.label.toLowerCase()].filter(Boolean).join(" · ");
  }

  function initialOptions() {
    if (params.get("exam")) return { ...EXAM_PRESET };
    const reading = FRM.findReading(params.get("reading"));
    const book = FRM.findBook(params.get("book"));
    const entries = (params.get("entries") || "").split(",").filter((id) => FRM.findEntry(id));
    const scope = entries.length ? ENTRIES_SCOPE : reading ? `reading:${reading.id}` : book ? `book:${book.id}` : "all";
    const selection = bank.SELECTIONS.some((s) => s.id === params.get("select")) ? params.get("select") : "all";
    const match = params.get("match") === "all" ? "all" : "any";
    return { scope, entries, match, selection, count: null, order: "pdf", mode: "training", countdown: false, weighted: false };
  }

  let options = initialOptions();

  // ------------------------------------------------------------------ réglage

  function scopeSelect() {
    const option = (value, label) => `<option value="${value}"${value === options.scope ? " selected" : ""}>${esc(label)}</option>`;
    const books = FRM.books.map((b) => option(`book:${b.id}`, `Livre ${b.id} · ${b.title}`)).join("");
    const readings = FRM.books
      .map((b) => `<optgroup label="${esc(`Livre ${b.id} · ${b.title}`)}">${b.readings.map((r) => option(`reading:${r.id}`, `${r.tag} · ${r.title}`)).join("")}</optgroup>`)
      .join("");
    const corpus = linkedEntries().length ? `<optgroup label="Corpus">${option(ENTRIES_SCOPE, "Questions liées à des entrées du corpus…")}</optgroup>` : "";
    return `<select name="scope">${option("all", "Tout le programme")}${corpus}<optgroup label="Livres entiers">${books}</optgroup>${readings}</select>`;
  }

  /** Entries with linked questions, to choose; shown when the scope is "entries". The corpus search
   *  bar and its results on top, the chosen entries below as chips (× removes one). The chips carry
   *  the form's values: an entry filtered out of the results stays chosen. */
  function entriesFieldset() {
    if (!linkedEntries().length) return "";
    return `
    <fieldset class="field entries-field" data-when="entries"><legend>Entrées du corpus</legend>
      <div class="entries-match">
        ${radio("match", "any", "Au moins une", "questions liées à l'une des entrées choisies")}
        ${radio("match", "all", "Toutes", "seulement celles liées à toutes les entrées choisies")}
      </div>
      <div class="entries-search" data-entries-search></div>
      <div class="entries-list" data-entries-list></div>
      <div class="small muted" data-entries-status></div>
      <div class="entries-picked" data-entries-picked>${pickedChips()}</div>
    </fieldset>`;
  }

  function pickedChips() {
    const chosen = (options.entries || []).map(FRM.findEntry).filter(Boolean);
    if (!chosen.length) return `<span class="small muted">Aucune entrée choisie : coche des entrées ci-dessus.</span>`;
    const chip = (entry) =>
      `<span class="entry-pick">${ui.typeTag(entry.type)} ${esc(entry.titre)}<input type="hidden" name="entries" value="${esc(entry.id)}"><button type="button" class="pick-remove" data-unpick="${esc(entry.id)}" title="Retirer" aria-label="${esc(`Retirer ${entry.titre}`)}">×</button></span>`;
    return `<span class="small muted">Choisies (${chosen.length}) :</span>${chosen.map(chip).join("")}`;
  }

  // The bar's filters, kept when the setup is rebuilt (corpus-search.js).
  const entriesSearchState = {};
  let entriesBar = null;

  function mountEntriesSearch() {
    const box = root().querySelector("[data-entries-search]");
    entriesBar = box
      ? FRM.corpusSearch.create(box, {
          state: entriesSearchState,
          offer: (entry) => (entry.questions || []).length > 0,
          placeholder: "Chercher une entrée : titre ou identifiant…",
          onChange: renderEntryChoices,
        })
      : null;
    if (!entriesBar) return;
    entriesBar.setEntries(FRM.corpusEntries());
    renderEntryChoices();
  }

  /** The bar's results, to tick (linked entries greyed); ticking never rebuilds the bar. */
  function renderEntryChoices() {
    const list = root().querySelector("[data-entries-list]");
    if (!list || !entriesBar) return;
    const { offered, shown, linked } = entriesBar.results();
    const chosen = new Set(options.entries || []);
    const item = (entry, via = null) => `<label class="choice entry-choice${via ? " is-linked" : ""}"><input type="checkbox" data-entry-pick value="${esc(entry.id)}"${chosen.has(entry.id) ? " checked" : ""}>
      <span>${ui.typeTag(entry.type)} ${esc(entry.titre)} <span class="muted small">(${ui.plural(entry.questions.length, "question")})</span>${via ? ` <span class="elinked">${esc(FRM.linkedLabel(via, FRM.corpusEntries()))}</span>` : ""}</span></label>`;
    list.innerHTML = [...shown.map((entry) => item(entry)), ...linked.map((l) => item(l.entry, l.via))].join("") || `<div class="small muted">Aucune entrée ne correspond à ces filtres.</div>`;
    root().querySelector("[data-entries-status]").textContent =
      `${shown.length}${linked.length ? ` + ${linked.length} liée${linked.length > 1 ? "s" : ""}` : ""} sur ${ui.plural(offered.length, "entrée")} ayant des questions liées`;
  }

  /** Adds or removes a chosen entry: chips (the form's values) and the matching checkbox. */
  function pickEntry(id, on) {
    const chosen = new Set(options.entries || []);
    if (on) chosen.add(id);
    else chosen.delete(id);
    options.entries = [...chosen];
    root().querySelector("[data-entries-picked]").innerHTML = pickedChips();
    const box = root().querySelector(`[data-entry-pick][value="${CSS.escape(id)}"]`);
    if (box) box.checked = on;
  }

  const radio = (name, value, label, hint = "") =>
    `<label class="choice"><input type="radio" name="${name}" value="${value}"${options[name] === value ? " checked" : ""}>
      <span>${label}${hint ? ` <span class="muted small">${hint}</span>` : ""}</span></label>`;

  function setupCard() {
    const selections = bank.SELECTIONS.map((s) => radio("selection", s.id, esc(s.label), `<span data-pool="${s.id}"></span>`)).join("");
    const counts = COUNTS.map((n) => `<option value="${n || ""}"${n === options.count ? " selected" : ""}>${n || "Toutes"}</option>`).join("");
    return `
<form class="card setup" data-setup>
  <h2>Nouvelle série</h2>
  <div class="setup-grid">
    <label class="field">Périmètre ${scopeSelect()}</label>
    <label class="field">Nombre de questions <select name="count">${counts}</select></label>
    ${entriesFieldset()}
    <fieldset class="field"><legend>Questions</legend>${selections}</fieldset>
    <fieldset class="field"><legend>Mode</legend>
      ${radio("mode", "training", "Entraînement", "correction après chaque question")}
      ${radio("mode", "exam", "Examen", "correction à la fin")}
    </fieldset>
    <fieldset class="field"><legend>Ordre</legend>
      ${radio("order", "pdf", "Ordre du PDF")}
      ${radio("order", "random", "Aléatoire")}
    </fieldset>
    <fieldset class="field" data-options><legend>Options</legend>
      <label class="choice" data-when="exam"><input type="checkbox" name="countdown"${options.countdown ? " checked" : ""}>
        <span>Compte à rebours <span class="muted small">au rythme de l'examen : ${view.clock(bank.EXAM_PACE_MS)} par question</span></span></label>
      <label class="choice" data-when="all"><input type="checkbox" name="weighted"${options.weighted ? " checked" : ""}>
        <span>Répartir selon les poids de l'examen <span class="muted small">20 / 20 / 30 / 30 %</span></span></label>
    </fieldset>
  </div>
  <div class="save-actions">
    <button type="submit" class="btn">Lancer · <span data-launch-count></span></button>
    <button type="button" class="btn ghost" data-exam-preset>Examen blanc · 100 questions · 4 h</button>
  </div>
</form>`;
  }

  function resumeCard() {
    const active = store.activeSession.get();
    if (!active) return "";
    const done = active.ids.filter((id) => (active.mode === "exam" ? active.answers[id] : active.validated[id])).length;
    return `
<div class="card resume">
  <div><div class="kicker">Série en cours</div>
  <strong>${esc(active.label)}</strong> · ${active.mode === "exam" ? "examen" : "entraînement"} · ${done} / ${active.ids.length} répondues</div>
  <div class="save-actions"><button type="button" class="btn" data-resume>Reprendre</button>
  <button type="button" class="btn ghost" data-abandon>Abandonner</button></div>
</div>`;
  }

  function historyCard() {
    const recent = [...store.sessions.all()].sort((a, b) => b.finishedAt - a.finishedAt);
    if (!recent.length) return "";
    const rows = recent.map((s) => {
      const base = s.mode === "exam" ? s.total : s.answered;
      return `<tr><td class="nowrap">${ui.dateTime(s.finishedAt)}</td><td>${esc(s.label)}</td><td>${s.mode === "exam" ? "Examen" : "Entraînement"}</td>
        <td class="num">${s.correct} / ${base}</td><td class="num">${ui.percent(base ? s.correct / base : 0)}</td><td class="num">${view.duration(s.ms)}</td>
        <td><a href="quiz.html?session=${encodeURIComponent(s.id)}">Revoir</a></td></tr>`;
    });
    return `
<div class="card">
  <h2>Historique des séries</h2>
  <p class="small muted">« Revoir » rouvre le bilan d'une série : tes réponses, tes erreurs et les corrections.</p>
  <div class="table-wrap history"><table class="data"><thead><tr><th>Date</th><th>Série</th><th>Mode</th><th class="num">Bonnes</th><th class="num">Score</th><th class="num">Durée</th><th></th></tr></thead>
  <tbody>${rows.join("")}</tbody></table></div>
  <p class="src">Toutes les statistiques : <a href="dashboard.html">dashboard</a>.</p>
</div>`;
  }

  function readForm(form) {
    const data = new FormData(form);
    return {
      scope: data.get("scope"),
      entries: data.getAll("entries"),
      match: data.get("match") || "any",
      selection: data.get("selection"),
      count: Number(data.get("count")) || null,
      order: data.get("order") || "random", // désactivé quand la série est répartie selon les poids
      mode: data.get("mode"),
      countdown: data.get("countdown") === "on",
      weighted: data.get("weighted") === "on",
    };
  }

  /** Recharge le périmètre choisi et met à jour les nombres affichés du formulaire. */
  async function refreshSetup() {
    const form = root().querySelector("[data-setup]");
    if (!form) return;
    options = readForm(form);
    const entriesField = form.querySelector("[data-when='entries']");
    if (entriesField) entriesField.hidden = options.scope !== ENTRIES_SCOPE;
    const pool = await scopePool(options);
    for (const s of bank.SELECTIONS) form.querySelector(`[data-pool="${s.id}"]`).textContent = `(${bank.filterPool(pool, s.id).length})`;
    const available = bank.filterPool(pool, options.selection).length;
    const n = options.count ? Math.min(options.count, available) : available;
    form.querySelector("[data-launch-count]").textContent = ui.plural(n, "question");
    form.querySelector("[data-when='exam']").hidden = options.mode !== "exam";
    form.querySelector("[data-when='all']").hidden = options.scope !== "all";
    form.querySelector("[data-options]").hidden = options.mode !== "exam" && options.scope !== "all";
    form.querySelectorAll("input[name='order']").forEach((input) => (input.disabled = options.weighted && options.scope === "all"));
  }

  /** Onglets de la page : séries (réglage, historique) ou catalogue des questions. */
  function tabs(active) {
    const tab = (id, label) => `<button type="button" class="toggle" data-quiz-tab="${id}" aria-pressed="${active === id}">${label}</button>`;
    return `<div class="view-switch quiz-tabs" role="group" aria-label="Vue">${tab("setup", "Séries")}${tab("catalogue", "Catalogue")}</div>`;
  }

  function renderSetup() {
    screen = "setup";
    stopClock();
    root().innerHTML = tabs("setup") + resumeCard() + setupCard() + historyCard();
    mountEntriesSearch();
    refreshSetup();
  }

  function renderCatalogue(initial = {}) {
    screen = "catalogue";
    stopClock();
    root().innerHTML = `${tabs("catalogue")}<div data-catalogue></div>`;
    FRM.questionCatalogue.render(root().querySelector("[data-catalogue]"), initial);
  }

  // ------------------------------------------------------------------ lancement

  function persistSession() {
    if (session) store.activeSession.set(session);
  }

  /** Démarre une série sur des questions déjà choisies. */
  function launch(series, launchOptions) {
    if (!series.length) return ui.flash("Aucune question ne correspond à ces critères.");
    if (store.activeSession.get() && !window.confirm("Une série est en cours : l'abandonner pour lancer celle-ci ?")) return;
    const now = Date.now();
    const timeLimit = launchOptions.mode === "exam" && launchOptions.countdown ? series.length * bank.EXAM_PACE_MS : null;
    session = {
      id: `s${now.toString(36)}`,
      mode: launchOptions.mode,
      label: describe(launchOptions),
      options: launchOptions,
      readingIds: [...new Set(series.map((q) => q.reading))],
      ids: series.map((q) => q.id),
      index: 0,
      answers: {},
      validated: {},
      spent: {},
      startedAt: now,
      timeLimit,
      deadline: timeLimit ? now + timeLimit : null,
    };
    byId = new Map(series.map((q) => [q.id, q]));
    persistSession();
    renderRun();
  }

  async function startFromOptions(launchOptions) {
    const pool = await scopePool(launchOptions);
    const weighted = launchOptions.weighted && launchOptions.scope === "all";
    launch(bank.buildSeries(pool, { ...launchOptions, weighted }), launchOptions);
  }

  async function startSingle(readingId, questionId) {
    const pool = await bank.load([readingId]);
    const question = pool.find((q) => q.id === questionId);
    if (!question) return renderSetup();
    launch([question], { scope: `reading:${readingId}`, selection: "all", mode: "training", label: `Q.${questionId} · ${FRM.findReading(readingId).tag}` });
  }

  async function resume() {
    session = store.activeSession.get();
    if (!session) return renderSetup();
    const pool = await bank.load(session.readingIds);
    byId = new Map(pool.filter((q) => session.ids.includes(q.id)).map((q) => [q.id, q]));
    renderRun();
  }

  // ------------------------------------------------------------------ déroulé

  const currentId = () => session.ids[session.index];
  const current = () => byId.get(currentId());
  const isDone = (id) => (session.mode === "exam" ? Boolean(session.answers[id]) : Boolean(session.validated[id]));

  /** Ajoute le temps écoulé sur la question courante. */
  function accumulate() {
    if (!session || shownAt === null) return;
    const id = currentId();
    session.spent[id] = (session.spent[id] || 0) + (Date.now() - shownAt);
    shownAt = Date.now();
  }

  function palette() {
    const cells = session.ids.map((id, i) => {
      const classes = ["pal", session.answers[id] && "is-answered", i === session.index && "is-current", bank.isFlagged({ id }) && "is-flagged"];
      return `<button type="button" class="${classes.filter(Boolean).join(" ")}" data-goto="${i}" title="Question ${i + 1}">${i + 1}</button>`;
    });
    return `
<div class="card">
  <div class="viz-head"><h2>Questions</h2><button type="button" class="btn" data-finish>Terminer l'examen</button></div>
  <div class="palette">${cells.join("")}</div>
  <p class="src">Foncé : répondue · cadre : question affichée · point : marquée.</p>
</div>`;
  }

  function actions(training, validated, last) {
    if (training) {
      const primary = validated
        ? `<button type="button" class="btn" data-next>${last ? "Voir le bilan" : "Question suivante →"}</button>`
        : `<button type="button" class="btn" data-validate>Valider</button>`;
      return `${primary}<button type="button" class="link-btn" data-finish>Terminer la série</button>`;
    }
    return `
<button type="button" class="btn ghost" data-prev${session.index === 0 ? " disabled" : ""}>← Précédente</button>
<button type="button" class="btn" data-next${last ? " disabled" : ""}>Suivante →</button>`;
  }

  function renderRun() {
    screen = "run";
    const question = current();
    const training = session.mode === "training";
    const choice = session.answers[question.id] || null;
    const validated = Boolean(session.validated[question.id]);
    const last = session.index === session.ids.length - 1;
    const done = session.ids.filter(isDone).length;
    shownAt = training && validated ? null : Date.now();

    root().innerHTML = `
<div class="card quiz-head">
  <div class="quiz-top">
    <div>
      <div class="kicker">${training ? "Entraînement" : "Examen"} · ${esc(session.label)}</div>
      <div class="quiz-pos">Question ${session.index + 1} / ${session.ids.length} <span class="muted small">· ${done} ${training ? "validées" : "répondues"}</span></div>
    </div>
    <div class="quiz-clocks">
      <span title="Temps sur cette question">⏱ <strong data-clock="question"></strong> <span class="muted small">/ repère ${view.clock(bank.EXAM_PACE_MS)}</span></span>
      ${session.deadline ? `<span title="Temps restant">⏳ <strong data-clock="remaining"></strong></span>` : `<span title="Temps total de la série">Σ <strong data-clock="total"></strong></span>`}
    </div>
  </div>
  <div class="meter"><div class="meter-fill" style="width:${(done / session.ids.length) * 100}%"></div></div>
</div>
<article class="card question">
  <div class="q-heading">${view.heading(question)}</div>
  <div class="doc-text q-stem">${view.blocks(question.stem)}</div>
  ${view.options(question, { choice, reveal: training && validated, locked: training && validated })}
  ${training && validated ? view.correction(question, choice) : ""}
  <div class="q-footer">${view.flagButtons(question)}${training && validated ? "" : `<span class="src">${view.sourceLink(question)}</span>`}</div>
  <div class="q-actions">${actions(training, validated, last)}</div>
</article>
${training ? "" : palette()}
<p class="src">Clavier : A à D (ou 1 à 4) pour répondre, Entrée pour ${training ? "valider puis continuer" : "passer à la suivante"}${training ? "" : ", flèches ← → pour naviguer"}.</p>`;
    startClock();
  }

  function choose(letter) {
    const question = current();
    if (session.mode === "training" && session.validated[question.id]) return;
    session.answers[question.id] = letter;
    persistSession();
    root().querySelectorAll("[data-choice]").forEach((b) => {
      const chosen = b.dataset.choice === letter;
      b.classList.toggle("is-chosen", chosen);
      b.setAttribute("aria-pressed", String(chosen));
    });
    const cell = root().querySelector(`[data-goto="${session.index}"]`);
    if (cell) cell.classList.add("is-answered");
  }

  function validate() {
    const question = current();
    const choice = session.answers[question.id];
    if (!choice) return ui.flash("Choisis une réponse avant de valider.");
    accumulate();
    shownAt = null;
    session.validated[question.id] = true;
    bank.recordAnswers([{ question, choice, ms: session.spent[question.id] }], session.id);
    persistSession();
    renderRun();
  }

  function goTo(index) {
    if (index < 0 || index >= session.ids.length) return;
    accumulate();
    session.index = index;
    persistSession();
    renderRun();
  }

  function next() {
    if (session.index === session.ids.length - 1) {
      if (session.mode === "training") finish("done");
      return;
    }
    goTo(session.index + 1);
  }

  function primaryAction() {
    if (session.mode === "exam") return next();
    return session.validated[currentId()] ? next() : validate();
  }

  // ------------------------------------------------------------------ chronomètre

  function stopClock() {
    clearInterval(clockTimer);
    clockTimer = null;
  }

  function startClock() {
    stopClock();
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function tick() {
    if (!session) return stopClock();
    const running = shownAt === null ? 0 : Date.now() - shownAt;
    const onQuestion = (session.spent[currentId()] || 0) + running;
    const total = Object.values(session.spent).reduce((sum, ms) => sum + ms, 0) + running;
    const set = (key, text) => {
      const el = root().querySelector(`[data-clock="${key}"]`);
      if (el) el.textContent = text;
    };
    set("question", view.clock(onQuestion));
    set("total", view.clock(total));
    if (session.deadline) {
      const remaining = session.deadline - Date.now();
      set("remaining", view.clock(remaining));
      if (remaining <= 0) finish("time");
    }
  }

  // ------------------------------------------------------------------ fin et bilan

  function finish(reason) {
    accumulate();
    stopClock();
    const s = session;
    const counted = (id) => (s.mode === "exam" || s.validated[id] ? s.answers[id] || null : null);
    const rows = s.ids.map((id) => ({ question: byId.get(id), choice: counted(id), ms: s.spent[id] || 0 }));
    if (s.mode === "exam") bank.recordAnswers(rows.filter((r) => r.choice), s.id);

    const answered = rows.filter((r) => r.choice).length;
    const correct = rows.filter((r) => r.choice === r.question.answer).length;
    const ms = rows.reduce((sum, r) => sum + r.ms, 0);
    if (answered) {
      store.sessions.add({ id: s.id, mode: s.mode, label: s.label, startedAt: s.startedAt, finishedAt: Date.now(), total: s.ids.length, answered, correct, ms, timeLimit: s.timeLimit });
    }
    store.activeSession.clear();
    session = null;
    summary = { ...s, rows, answered, correct, ms, reason, total: s.ids.length, reviewedAt: null };
    renderSummary();
    ui.refresh();
  }

  function confirmFinish() {
    const unanswered = session.ids.filter((id) => !isDone(id)).length;
    const message =
      session.mode === "exam"
        ? `Terminer l'examen ?${unanswered ? `\n\n${ui.plural(unanswered, "question")} sans réponse compteront comme fausses.` : ""}`
        : "Terminer la série ? Les réponses validées sont déjà enregistrées.";
    if (window.confirm(message)) finish("stop");
  }

  function byReadingTable(rows) {
    const groups = new Map();
    for (const row of rows) {
      const g = groups.get(row.question.reading) || { total: 0, correct: 0 };
      g.total += 1;
      g.correct += row.choice === row.question.answer ? 1 : 0;
      groups.set(row.question.reading, g);
    }
    const lines = [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, g]) => {
        const r = FRM.findReading(id);
        return `<tr><td class="nowrap">${esc(r.tag)}</td><td><a href="${ui.readingHref(r)}">${esc(r.title)}</a></td>
          <td class="num">${g.correct} / ${g.total}</td><td class="num">${ui.percent(g.correct / g.total)}</td></tr>`;
      });
    return `<div class="table-wrap"><table class="data"><thead><tr><th>Réf.</th><th>Nom</th><th class="num">Bonnes</th><th class="num">Score</th></tr></thead><tbody>${lines.join("")}</tbody></table></div>`;
  }

  function detailRow(row, i) {
    const q = row.question;
    const state = !row.choice ? "is-skipped" : row.choice === q.answer ? "is-right" : "is-wrong";
    const status = { "is-skipped": "— Sans réponse", "is-right": "✓ Juste", "is-wrong": "✗ Faux" }[state];
    const treated = store.treated.has(q.id) ? " is-treated" : "";
    return `
<details class="q-detail ${state}${treated}" data-qid="${esc(q.id)}">
  <summary><span class="q-num">${i + 1}</span><span class="q-status">${status}</span><span class="q-treated-badge">✓ Traitée</span>
    <span>${view.heading(q)} <span class="muted small">· ${row.choice ? `ta réponse ${row.choice} · ` : ""}bonne réponse ${q.answer} · ${view.clock(row.ms)}</span></span></summary>
  <div class="q-detail-body">
    <div class="doc-text q-stem">${view.blocks(q.stem)}</div>
    ${view.options(q, { choice: row.choice, reveal: true, locked: true })}
    ${view.correction(q, row.choice)}
    <div class="q-footer">${view.flagButtons(q)}<button type="button" class="btn ghost" data-next-untreated>Suivante non traitée ↓</button></div>
  </div>
</details>`;
  }

  function renderSummary() {
    screen = "summary";
    const s = summary;
    const exam = s.mode === "exam";
    const base = exam ? s.total : s.answered;
    const timed = s.rows.filter((r) => r.choice && r.ms > 0);
    const avg = timed.length ? timed.reduce((sum, r) => sum + r.ms, 0) / timed.length : null;
    const pace = bank.EXAM_PACE_MS;
    const paceNote = avg === null ? "" : avg > pace ? "plus lent que le rythme d'examen" : "dans le rythme d'examen";
    const retry = s.rows.filter((r) => (exam ? r.choice !== r.question.answer : r.choice && r.choice !== r.question.answer));
    const shown = exam ? s.rows : s.rows.filter((r) => r.choice);
    const tile = (value, label, sub = "") => `<div class="stat"><div class="num">${value}</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;

    root().innerHTML = `
<div class="card">
  <div class="kicker">${exam ? "Examen" : "Entraînement"} · ${esc(s.label)}${s.reason === "time" ? " · temps écoulé" : ""}</div>
  <h2>Bilan${s.reviewedAt ? ` du ${ui.dateTime(s.reviewedAt)}` : ""}</h2>
  ${s.reviewedAt && s.total > s.answered ? `<p class="small muted">${ui.plural(s.total - s.answered, "question")} laissée(s) sans réponse : non enregistrée(s), elles comptent comme fausses dans le score.</p>` : ""}
  <div class="stat-row">
    ${tile(ui.percent(base ? s.correct / base : 0), exam ? "Score" : "Réussite", `${s.correct} / ${base} ${exam ? "questions" : "réponses"}`)}
    ${tile(`${s.answered} / ${s.total}`, "Répondues", exam ? "sans réponse = faux" : "validées")}
    ${tile(view.duration(s.ms), "Temps total", s.timeLimit ? `limite ${view.duration(s.timeLimit)}` : "")}
    ${tile(avg === null ? "—" : view.clock(avg), "Temps moyen", `repère ${view.clock(pace)} · ${paceNote}`)}
  </div>
  <div class="save-actions">
    ${retry.length ? `<button type="button" class="btn" data-retry>Refaire les erreurs (${retry.length})</button>` : ""}
    <button type="button" class="btn ghost" data-new>Nouvelle série</button>
    <a class="btn ghost" href="dashboard.html">Dashboard</a>
  </div>
</div>
${shown.length ? `<div class="card"><h2>Par reading</h2>${byReadingTable(shown)}</div>` : ""}
<div class="card">
  <h2>Détail des questions</h2>
  <p class="small muted">Ouvre une question pour revoir l'énoncé et la correction. « ✓ Traitée » quand tu l'as exploitée (fiche, corpus).</p>
  ${shown.length ? `
  <div class="treated-bar">
    <strong data-treated-count></strong>
    <label class="small"><input type="checkbox" data-hide-treated${hideTreated ? " checked" : ""}> Masquer les traitées</label>
    <button type="button" class="btn ghost" data-next-untreated>Question non traitée suivante ↓</button>
  </div>
  <div class="q-details${hideTreated ? " hide-treated" : ""}" data-detail-list>${shown.map(detailRow).join("")}</div>` : `<div class="placeholder">Aucune réponse enregistrée dans cette série.</div>`}
</div>`;
    refreshTreated();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ questions traitées (bilan)

  let hideTreated = false; // « Masquer les traitées », gardé d'un bilan à l'autre pendant la visite

  const detailList = () => root().querySelector("[data-detail-list]");

  /** Badges et compteur « n / N traitées » du bilan, après un clic sur ✓ Traitée. */
  function refreshTreated() {
    const list = detailList();
    if (!list) return;
    const items = [...list.querySelectorAll("[data-qid]")];
    items.forEach((item) => item.classList.toggle("is-treated", store.treated.has(item.dataset.qid)));
    const ids = new Set(items.map((item) => item.dataset.qid));
    const done = [...ids].filter((id) => store.treated.has(id)).length;
    root().querySelector("[data-treated-count]").textContent = `${done} / ${ids.size} traitée${done > 1 ? "s" : ""}`;
  }

  /** Ouvre la prochaine question non traitée après celle qui est ouverte (sinon depuis le début). */
  function nextUntreated() {
    const items = [...detailList().querySelectorAll("[data-qid]")];
    const current = items.findIndex((item) => item.open);
    const untreated = (item) => !store.treated.has(item.dataset.qid);
    const next = items.find((item, i) => i > current && untreated(item)) || items.find(untreated);
    items.forEach((item) => (item.open = false));
    if (!next) return ui.flash("Toutes les questions de cette série sont traitées.");
    next.open = true;
    next.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  document.addEventListener("frm:treated", () => screen === "summary" && refreshTreated());

  /** Bilan d'une série terminée, reconstruit depuis ses réponses enregistrées. */
  async function review(sessionId) {
    const meta = store.sessions.all().find((s) => s.id === sessionId);
    const attempts = store.attempts.all().filter((a) => a.session === sessionId).sort((a, b) => a.at - b.at);
    if (!attempts.length) {
      ui.flash("Aucune réponse enregistrée pour cette série.");
      return renderSetup();
    }
    const pool = await bank.load([...new Set(attempts.map((a) => a.reading))]);
    const byQuestion = new Map(pool.map((q) => [q.id, q]));
    const rows = attempts
      .map((a) => ({ question: byQuestion.get(a.q), choice: a.choice, ms: a.ms || 0 }))
      .filter((r) => r.question);
    const mode = meta ? meta.mode : "training";
    summary = {
      mode,
      label: meta ? meta.label : "Série",
      options: { scope: "all", selection: "all", mode, countdown: false },
      ids: rows.map((r) => r.question.id),
      rows,
      answered: rows.length,
      correct: rows.filter((r) => r.choice === r.question.answer).length,
      ms: rows.reduce((sum, r) => sum + r.ms, 0),
      total: meta && mode === "exam" ? meta.total : rows.length,
      timeLimit: meta ? meta.timeLimit : null,
      reason: null,
      reviewedAt: meta ? meta.finishedAt : attempts[attempts.length - 1].at,
    };
    renderSummary();
  }

  // ------------------------------------------------------------------ événements
  // Posés sur le document : le contenu de la page est entièrement re-rendu à chaque étape.

  document.addEventListener("click", (event) => {
    const target = event.target.closest(
      "[data-choice], [data-validate], [data-next], [data-prev], [data-goto], [data-finish], [data-resume], [data-abandon], [data-exam-preset], [data-retry], [data-new], [data-next-untreated], [data-quiz-tab]"
    );
    if (!target || !root().contains(target)) return;
    const d = target.dataset;
    if ("choice" in d && screen === "run") choose(d.choice);
    else if ("validate" in d) validate();
    else if ("next" in d) next();
    else if ("prev" in d) goTo(session.index - 1);
    else if ("goto" in d) goTo(Number(d.goto));
    else if ("finish" in d) confirmFinish();
    else if ("resume" in d) resume();
    else if ("abandon" in d) {
      if (!window.confirm("Abandonner la série en cours ? Les réponses déjà validées restent enregistrées.")) return;
      store.activeSession.clear();
      renderSetup();
    } else if ("examPreset" in d) {
      options = { ...EXAM_PRESET };
      startFromOptions(options);
    } else if ("retry" in d) {
      const exam = summary.mode === "exam";
      const retry = summary.rows.filter((r) => (exam ? r.choice !== r.question.answer : r.choice && r.choice !== r.question.answer));
      launch(retry.map((r) => r.question), { ...summary.options, label: `${summary.label} · erreurs`, count: null });
    } else if ("new" in d) renderSetup();
    else if ("nextUntreated" in d) nextUntreated();
    else if (d.quizTab === "catalogue") {
      history.replaceState(null, "", "quiz.html?vue=catalogue");
      renderCatalogue();
    } else if (d.quizTab === "setup") {
      history.replaceState(null, "", "quiz.html");
      renderSetup();
    }
  });

  document.addEventListener("click", (event) => {
    const unpick = event.target.closest("[data-unpick]");
    if (!unpick || !root().contains(unpick)) return;
    pickEntry(unpick.dataset.unpick, false);
    refreshSetup();
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-entry-pick]")) pickEntry(event.target.value, event.target.checked); // before reading the form
    if (event.target.closest("[data-setup]")) refreshSetup();
    if (event.target.matches("[data-hide-treated]")) {
      hideTreated = event.target.checked;
      detailList().classList.toggle("hide-treated", hideTreated);
    }
  });

  document.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-setup]")) return;
    event.preventDefault();
    startFromOptions(readForm(event.target));
  });

  document.addEventListener("keydown", (event) => {
    if (screen !== "run" || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest("input, select, textarea, summary")) return; // le clavier natif garde la main
    const button = event.target.closest("button");
    const key = event.key.toUpperCase();
    const letter = { 1: "A", 2: "B", 3: "C", 4: "D" }[key] || (view.LETTERS.includes(key) ? key : null);
    if (letter) choose(letter);
    else if (event.key === "Enter") {
      if (button && !button.matches("[data-choice]")) return; // Entrée sur un autre bouton : son propre clic
      primaryAction();
    }
    else if (event.key === "ArrowRight" && session.mode === "exam") goTo(session.index + 1);
    else if (event.key === "ArrowLeft" && session.mode === "exam") goTo(session.index - 1);
    else return;
    event.preventDefault();
  });

  // Temps et série gardés si l'onglet est caché ou fermé.
  const saveProgress = () => {
    if (!session) return;
    accumulate();
    persistSession();
  };
  window.addEventListener("pagehide", saveProgress);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveProgress());

  // ------------------------------------------------------------------ démarrage

  ui.mount({
    active: "quiz",
    title: "Questions",
    trail: [{ label: "Accueil", href: "index.html" }, { label: "Questions" }],
    body: `<div id="quiz"></div>`,
  });

  // The corpus manifest first: entries linked to each question, and the "corpus entries" scope.
  ui.loadScript("notes/corpus/index.js")
    .catch(() => {
      /* no corpus yet: the server writes the manifest when it starts */
    })
    .then(() => {
      if (params.get("entries")) options = initialOptions(); // entries are known only now
      const singleReading = FRM.findReading(params.get("reading"));
      const singleBook = FRM.findBook(params.get("book"));
      if (params.get("session")) review(params.get("session"));
      else if (params.get("vue") === "catalogue") {
        renderCatalogue({ scope: singleReading ? `reading:${singleReading.id}` : singleBook ? `book:${singleBook.id}` : undefined });
      } else if (params.get("q") && singleReading) startSingle(singleReading.id, params.get("q"));
      else renderSetup();
    });
})(window.FRM, window.FRM.ui, window.FRM.quizView);
