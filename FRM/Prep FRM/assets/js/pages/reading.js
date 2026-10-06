/* Page d'un reading (reading.html?id=N) : références aux PDFs, étapes, learning
 * objectives, puis nos contenus : simulations, fiches Typst et entrées du corpus
 * rattachées au reading. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const reading = FRM.findReading(ui.queryId());
  if (!reading) return ui.mountNotFound("Ce reading");

  const book = FRM.bookOf(reading);

  function head() {
    const { objectives: lo, questions: q, note } = reading;
    const ref = (sourceKey, page, label, value) =>
      `<a class="ref" href="${FRM.pdfHref(sourceKey, page)}" target="_blank" rel="noopener"><span class="rlbl">${label}</span>${value}</a>`;
    return `
<div class="card reading-head">
  <div class="kicker">Livre ${book.id} · Chapitre ${reading.chapter} · ${esc(reading.tag)}</div>
  <h2>${esc(reading.title)}</h2>
  ${ui.meter(`reading:${reading.id}`)}
  ${ui.meter(`reading:${reading.id}`, { kind: "confidence" })}
  <p class="src">Barre orange : étapes cochées. Barre bleue : confiance, <span data-rated="reading:${reading.id}"></span> LOs notés.</p>
  <div class="refs">
    ${ref(lo.source, lo.page, "Learning objectives", `${ui.plural(lo.items.length, "LO")} · p. ${lo.page}`)}
    ${ref(q.source, q.firstPage, "Questions AnalystPrep", `${ui.plural(q.count, "question")} · ${ui.pageRange(q.firstPage, q.lastPage)}`)}
    ${ref(book.guide.source, book.guide.page, "Study guide", `${esc(ui.shortTitle(book))} · ${ui.pageRange(book.guide.page, book.guide.lastPage)}`)}
  </div>
  ${note ? `<p class="src">${esc(note)} (${ui.sourceLink(lo.source, lo.page)})</p>` : ""}
</div>`;
  }

  function objectives() {
    const lo = reading.objectives;
    return `
<div class="card">
  <h2>Learning objectives</h2>
  <p class="small muted">Note ta confiance sur 4 pour chaque LO : ${ui.scoreLegend()}. Re-cliquer sur la note l'efface.</p>
  <div class="doc-text">
    <p>After completing this reading, you should be able to:</p>
    ${ui.objectiveList(reading)}
  </div>
  ${ui.source(lo.source, lo.page)}
</div>`;
  }

  // ------------------------------------------------------------------ questions AnalystPrep

  const quizHref = (query = "") => `quiz.html?reading=${reading.id}${query}`;
  const mark = (ok) => (ok === null ? "—" : ok ? `<span class="ok-mark">✓</span>` : `<span class="ko-mark">✗</span>`);

  function questionRows(list) {
    return list.map((q) => {
      const r = FRM.questions.recordOf(q.id);
      const avg = r && r.timedCount ? r.totalMs / r.timedCount : null;
      return `<tr>
  <td class="nowrap"><a href="${quizHref(`&q=${q.id}`)}" title="Refaire cette question">Q.${esc(q.id)}</a></td>
  <td class="num">${r ? r.count : 0}</td><td class="num">${r ? r.correctCount : 0}</td>
  <td class="num">${mark(r ? r.firstCorrect : null)}</td><td class="num">${mark(r ? r.lastCorrect : null)}</td>
  <td class="num">${avg === null ? "—" : FRM.quizView.clock(avg)}</td><td>${FRM.quizView.flagIcons(q.id)}</td>
</tr>`;
    });
  }

  async function renderQuestions() {
    const list = await FRM.questions.load([reading.id]);
    const s = FRM.questions.statsOf([reading]);
    const count = (selection) => FRM.questions.filterPool(list, selection).length;
    const rate = (value) => (value === null ? "—" : ui.percent(value));
    const tile = (value, label, sub = "") => `<div class="stat"><div class="num">${value}</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    const container = document.getElementById("questions");
    const wasOpen = Boolean(container.querySelector(".q-table-toggle[open]"));
    container.innerHTML = `
<div class="stat-row">
  ${tile(`${s.seen} / ${s.total}`, "Vues", `${s.unseen} jamais vues`)}
  ${tile(rate(s.firstRate), "1er essai", "réussite sur les vues")}
  ${tile(rate(s.lastRate), "Dernier essai", `${s.mastered} maîtrisées (2 justes de suite)`)}
  ${tile(s.attempts, "Essais", s.avgMs === null ? "" : `${FRM.quizView.clock(s.avgMs)} en moyenne`)}
  ${tile(`${s.treated} / ${s.total}`, "Traitées", "exploitées dans les fiches")}
</div>
<div class="save-actions">
  <a class="btn" href="${quizHref()}">Lancer une série</a>
  <a class="btn ghost" href="${quizHref("&select=unseen")}">Jamais vues (${count("unseen")})</a>
  <a class="btn ghost" href="${quizHref("&select=wrong")}">Ratées (${count("wrong")})</a>
  <a class="btn ghost" href="${quizHref("&select=flagged")}">Marquées (${count("flagged")})</a>
  <a class="btn ghost" href="${quizHref("&select=untreated")}">Non traitées (${count("untreated")})</a>
</div>
<details class="q-table-toggle">
  <summary>Suivi question par question (${list.length})</summary>
  <div class="table-wrap"><table class="data">
    <thead><tr><th>Question</th><th class="num">Essais</th><th class="num">Justes</th><th class="num">1er</th><th class="num">Dernier</th><th class="num">Temps moyen</th><th>Marques</th></tr></thead>
    <tbody>${questionRows(list).join("")}</tbody>
  </table></div>
</details>
<p class="src">L'étape 2 se coche d'elle-même quand toutes les questions ont été tentées. Source : ${ui.pdfLink(reading.questions.source, reading.questions.firstPage, `${esc(FRM.sources[reading.questions.source].title)}, ${ui.pageRange(reading.questions.firstPage, reading.questions.lastPage)}`)}.</p>`;
    container.querySelector(".q-table-toggle").open = wasOpen;
  }

  // ------------------------------------------------------------------ Things to Remember et calculs des corrigés

  function questionRef(q) {
    const page = ui.pdfLink(reading.questions.source, q.page, `p. ${q.page}`);
    return `<div class="fiche-ref"><strong>Q.${esc(q.id)}</strong> · ${page} · <a href="${quizHref(`&q=${q.id}`)}">refaire</a></div>`;
  }

  /** Dernière phrase du paragraphe qui précède un bloc de calcul : elle dit ce qui est calculé. */
  function leadIn(blocks, index) {
    const previous = blocks[index - 1];
    if (!previous || previous.type !== "p") return "";
    return previous.text.split(/(?<=[.:?!])\s+/).pop();
  }

  function calculations(q) {
    return q.explanation
      .map((block, i) => {
        if (block.type !== "pre") return "";
        const lead = leadIn(q.explanation, i);
        return `${lead ? `<p class="fiche-lead">${esc(lead)}</p>` : ""}<pre class="q-pre">${esc(block.text)}</pre>`;
      })
      .join("");
  }

  function renderRemember(list) {
    const remembered = list.filter((q) => q.remember.length);
    const computed = list.filter((q) => q.explanation.some((b) => b.type === "pre"));
    const points = remembered.reduce((sum, q) => sum + q.remember.length, 0);
    const none = (what) => `<div class="placeholder">Aucun ${what} dans les questions de ce reading.</div>`;
    const bank = FRM.sources[reading.questions.source].title;
    document.getElementById("remember").innerHTML = `
<details class="fiche">
  <summary>À retenir · ${ui.plural(points, "point")} de ${ui.plural(remembered.length, "question")}</summary>
  <div class="fiche-body">
    ${remembered.map((q) => `<div class="fiche-item">${questionRef(q)}<ul>${q.remember.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("") || none("encadré « Things to Remember »")}
  </div>
</details>
<details class="fiche">
  <summary>Calculs et formules · ${ui.plural(computed.length, "question")}</summary>
  <div class="fiche-body">
    <p class="src">Blocs de calcul des corrigés, précédés de la phrase qui les introduit. Exposants et fractions peuvent être abîmés : le lien de page ouvre le PDF.</p>
    ${computed.map((q) => `<div class="fiche-item">${questionRef(q)}${calculations(q)}</div>`).join("") || none("calcul")}
  </div>
</details>
<p class="src">Tiré tel quel des corrigés : ${esc(bank)}.</p>`;
  }

  function pager() {
    const { previous, next } = FRM.neighbours(reading);
    const before = previous ? `<a class="prev" href="${ui.readingHref(previous)}">← ${esc(previous.title)}</a>` : "";
    const after = next ? `<a class="next" href="${ui.readingHref(next)}">${esc(next.title)} →</a>` : "";
    return `<div class="pager">${before}${after}</div>`;
  }

  ui.mount({
    active: `book:${book.id}`,
    title: reading.title,
    trail: [
      { label: "Accueil", href: "index.html" },
      { label: `Livre ${book.id}`, href: ui.bookHref(book) },
      { label: `Chapitre ${reading.chapter}` },
    ],
    body: `
${head()}
<div class="card"><h2>Étapes</h2>${ui.stepList(reading)}</div>
${objectives()}
<div class="card"><h2>Things to Remember · AnalystPrep</h2><div id="remember"><div class="placeholder">Chargement…</div></div></div>
<div class="card"><h2>Questions AnalystPrep</h2><div id="questions"><div class="placeholder">Chargement des questions…</div></div></div>
<div class="card"><h2>Simulation Python</h2><div id="simulations"><div class="placeholder">Chargement…</div></div></div>
<div class="card" id="notes-card"><h2>Nos fiches</h2><div id="notes"><div class="placeholder">Chargement…</div></div></div>
<div class="card" id="corpus-card"><h2>Corpus de ce reading</h2><div id="corpus"><div class="placeholder">Chargement…</div></div></div>
${pager()}`,
  });

  FRM.questions.load([reading.id]).then(renderRemember);
  renderQuestions();
  document.addEventListener("frm:change", renderQuestions); // chargement d'une sauvegarde, autre onglet

  // ------------------------------------------------------------------ our notes (Typst, step 4)

  const withServer = location.protocol.startsWith("http");
  // ?auteur=x opens on that author's note (links from the notes portal and the corpus).
  let shownAuthor = new URLSearchParams(location.search).get("auteur");

  function editButton() {
    if (withServer) return `<a class="btn" href="editeur.html?reading=${reading.id}">✎ Éditer ma fiche</a>`;
    return `<span class="small muted">Pour écrire ou modifier une fiche, lance <code>Lancer Prep FRM.bat</code>.</span>`;
  }

  /** Compiled notes listed in notes/index.js, one tab per author (the current profile first). */
  function renderNotes() {
    const notes = FRM.notesOf(reading.id);
    const me = FRM.store.profile.authorSlug();
    const authors = Object.keys(notes).sort((a, b) => (b === me) - (a === me) || a.localeCompare(b));
    const container = document.getElementById("notes");
    if (!authors.length) {
      container.innerHTML = `<div class="placeholder">Aucune fiche pour ce reading.</div><div class="save-actions">${editButton()}</div>`;
      return;
    }
    if (!authors.includes(shownAuthor)) shownAuthor = authors[0];
    const note = notes[shownAuthor];
    const base = `notes/r${reading.id}/fiche-${shownAuthor}`;
    const version = `?v=${note.updatedAt}`; // the browser must not show a cached older rendering
    const tabs = authors
      .map((a) => `<button type="button" class="toggle" data-note-author="${esc(a)}" aria-pressed="${a === shownAuthor}">${esc(a.charAt(0).toUpperCase() + a.slice(1))}${a === me ? " (moi)" : ""}</button>`)
      .join("");
    const pages = Array.from({ length: note.pages }, (_, i) => `<img class="note-page" src="${base}-${i + 1}.svg${version}" alt="Fiche ${esc(reading.tag)}, page ${i + 1}">`);
    container.innerHTML = `
<div class="filter-group">${tabs}</div>
<div class="note-pages">${pages.join("")}</div>
<div class="save-actions">
  <a class="btn ghost" href="${base}.pdf${version}" target="_blank" rel="noopener">PDF</a>
  ${editButton()}
  <span class="small muted">Mise à jour : ${ui.dateTime(note.updatedAt)}</span>
</div>`;
  }

  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-note-author]");
    if (!tab) return;
    shownAuthor = tab.dataset.noteAuthor;
    renderNotes();
  });

  ui.loadScript("notes/index.js")
    .catch(() => {
      /* no notes yet: the manifest appears with the first saved note */
    })
    .then(() => {
      renderNotes();
      // The page is built by script: the browser cannot jump to #notes-card by itself.
      if (location.hash === "#notes-card") document.getElementById("notes-card").scrollIntoView();
    });

  // ------------------------------------------------------------------ corpus entries of this reading

  const newEntryHref = (type) => `entree.html${type ? `?type=${type}` : ""}`;

  function renderCorpus() {
    const entries = FRM.corpusOf(reading.id);
    const rows = entries.map(
      (entry) => `
<a class="entry-row" href="${ui.entryHref(entry)}">
  ${ui.typeTag(entry.type)}
  <span class="etitle">${esc(entry.titre)} <span class="entry-id">${esc(entry.id)}</span></span>
  <span class="eauthors">${entry.versions.map((v) => `<span class="initials" title="${esc(v.name)}">${esc(v.initials)}</span>`).join("")}</span>
</a>`
    );
    const actions = withServer
      ? `<a class="btn" href="editeur.html?reading=${reading.id}">✎ Citer une entrée dans ma fiche</a>`
      : `<span class="small muted">Pour écrire une entrée, lance <code>Lancer Prep FRM.bat</code>.</span>`;
    document.getElementById("corpus").innerHTML = `
${rows.length ? `<div class="entry-list">${rows.join("")}</div>` : `<div class="placeholder">Aucune entrée du corpus n'est citée ou insérée dans une fiche de ce reading.</div>`}
<p class="src">Une entrée rejoint ce reading dès qu'une fiche du reading la cite ou l'insère (menu « 📚 Corpus » de l'éditeur de fiche).</p>
<div class="save-actions">${actions}<a class="btn ghost" href="corpus.html?reading=${reading.id}">Voir dans le corpus</a></div>`;
  }

  // ------------------------------------------------------------------ simulations (corpus entries of type simulation)

  function renderSimulations() {
    const simulations = FRM.corpusOf(reading.id)
      .filter((entry) => entry.type === "simulation")
      .flatMap((entry) =>
        entry.versions
          .filter((v) => v.code)
          .map(
            (v) => `
<h3><a href="${ui.entryHref(entry)}">${esc(entry.titre)}</a> <span class="initials" title="${esc(v.name)}">${esc(v.initials)}</span></h3>
${ui.codeBlock(v.code)}
${FRM.runner.slot(entry, v)}`
          )
      );
    const create = withServer ? ` <a href="${newEntryHref("simulation")}">Crée une simulation</a> dans le corpus, puis cite-la ou insère-la dans ta fiche de ce reading.` : "";
    const container = document.getElementById("simulations");
    container.innerHTML = simulations.length
      ? simulations.join("")
      : `<div class="placeholder">Aucune simulation pour ce reading.${create}</div>`;
    FRM.runner.mountSlots(container);
  }

  ui.loadScript("notes/corpus/index.js")
    .catch(() => {
      /* no corpus yet: the server writes the manifest when it starts */
    })
    .then(() => {
      renderCorpus();
      renderSimulations();
    });
})(window.FRM, window.FRM.ui);
