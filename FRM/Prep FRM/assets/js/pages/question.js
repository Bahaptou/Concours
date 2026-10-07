/* Question page (question.html?reading=12&q=315): one AnalystPrep question outside any series.
 * Read it, try an answer (not recorded), show the correction, mark it, link it to the corpus, and
 * see its history: every attempt and the series it belongs to. Practising it for real is still a
 * series ("S'entraîner"), recorded like the others. Works without the server (file://). */
(function (FRM, ui, view) {
  "use strict";

  const { esc } = ui;
  const { store } = FRM;
  const bank = FRM.questions;
  const params = new URLSearchParams(location.search);
  const reading = FRM.findReading(params.get("reading"));
  const questionId = params.get("q");

  let question = null;
  let neighbours = { previous: null, next: null };
  let tried = null; // letter tried on this page: shown, never recorded
  let revealed = false;

  const pageHref = (q) => `question.html?reading=${q.reading}&q=${encodeURIComponent(q.id)}`;
  const catalogueHref = () => `quiz.html?vue=catalogue&reading=${reading.id}`;

  // ------------------------------------------------------------------ history

  function historyCard() {
    const record = bank.recordOf(question.id);
    const sessions = new Map(store.sessions.all().map((s) => [s.id, s]));
    const attempts = store.attempts.all().filter((a) => a.q === question.id).sort((a, b) => b.at - a.at);
    const tile = (value, label, sub = "") => `<div class="stat"><div class="num">${value}</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    const seriesCount = new Set(attempts.map((a) => a.session).filter(Boolean)).size;
    const avg = record && record.timedCount ? record.totalMs / record.timedCount : null;
    const last = record ? (record.lastCorrect ? `<span class="ok-mark">✓</span>` : `<span class="ko-mark">✗</span>`) : "—";
    const rows = attempts.map((a) => {
      const s = a.session ? sessions.get(a.session) : null;
      const series = s ? `<a href="quiz.html?session=${encodeURIComponent(s.id)}">${esc(s.label)}</a>` : `<span class="muted">hors série</span>`;
      const mode = s ? (s.mode === "exam" ? "Examen" : "Entraînement") : "—";
      return `<tr><td class="nowrap">${ui.dateTime(a.at)}</td><td>${series}</td><td>${mode}</td><td class="num">${esc(a.choice)}</td>
        <td>${a.correct ? `<span class="ok-mark">✓ juste</span>` : `<span class="ko-mark">✗ faux</span>`}</td><td class="num">${a.ms === null ? "—" : view.clock(a.ms)}</td></tr>`;
    });
    return `
<div class="card" data-history>
  <h2>Historique</h2>
  <div class="stat-row">
    ${tile(record ? record.count : 0, "Essais", record ? `premier le ${ui.dateTime(record.attempts[0].at)}` : "jamais faite")}
    ${tile(record ? `${record.correctCount} / ${record.count}` : "—", "Justes", record ? ui.percent(record.correctCount / record.count) : "")}
    ${tile(last, "Dernier essai", record && record.mastered ? "maîtrisée (2 justes de suite)" : "")}
    ${tile(avg === null ? "—" : view.clock(avg), "Temps moyen", `repère ${view.clock(bank.EXAM_PACE_MS)}`)}
    ${tile(seriesCount, "Séries", "où elle est apparue")}
  </div>
  ${rows.length
    ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Série</th><th>Mode</th><th class="num">Réponse</th><th>Résultat</th><th class="num">Temps</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<div class="placeholder">Jamais faite dans une série. « S'entraîner » la fait une fois, en l'enregistrant.</div>`}
</div>`;
  }

  // ------------------------------------------------------------------ question

  function questionCard() {
    const reveal = revealed || tried !== null;
    const correction = reveal ? view.correction(question, tried || question.answer) : "";
    const note = tried !== null ? `<p class="small muted">Essai libre : il n'est pas enregistré. Pour qu'il compte, « S'entraîner ».</p>` : "";
    return `
<article class="card question">
  <div class="q-heading">${view.heading(question)}</div>
  <div class="doc-text q-stem">${view.blocks(question.stem)}</div>
  ${view.options(question, { choice: tried, reveal, locked: reveal })}
  ${reveal ? "" : `<p class="small muted">Clique sur une réponse pour t'essayer (non enregistré), ou affiche directement la correction.</p>`}
  ${note}
  ${correction}
  <div class="q-footer">${view.flagButtons(question)}<span class="src">${view.sourceLink(question)}</span></div>
  <div class="q-actions">
    ${reveal ? `<button type="button" class="btn ghost" data-q-reset>Recommencer</button>` : `<button type="button" class="btn ghost" data-q-reveal>Afficher la correction</button>`}
    <a class="btn" href="quiz.html?reading=${reading.id}&amp;q=${encodeURIComponent(question.id)}" title="Une série d'une question : la réponse est enregistrée">S'entraîner (enregistré)</a>
  </div>
</article>`;
  }

  function navigation() {
    const link = (q, label) => (q ? `<a class="btn ghost" href="${pageHref(q)}">${label}</a>` : `<span></span>`);
    return `<div class="q-nav">${link(neighbours.previous, `← Q.${neighbours.previous ? esc(neighbours.previous.id) : ""}`)}<a href="${catalogueHref()}">Catalogue de ${esc(reading.tag)}</a>${link(neighbours.next, `Q.${neighbours.next ? esc(neighbours.next.id) : ""} →`)}</div>`;
  }

  function render() {
    document.getElementById("question").innerHTML = `${navigation()}${questionCard()}${historyCard()}`;
  }

  // ------------------------------------------------------------------ start

  function mount(body) {
    ui.mount({
      active: "quiz",
      title: question ? `Q.${question.id} · ${reading.tag}` : "Question",
      trail: [
        { label: "Accueil", href: "index.html" },
        { label: "Questions", href: "quiz.html" },
        { label: "Catalogue", href: reading ? catalogueHref() : "quiz.html?vue=catalogue" },
        { label: question ? `${reading.tag} · Q.${question.id}` : "Question" },
      ],
      body,
    });
  }

  async function start() {
    if (!reading || !questionId) return ui.mountNotFound("Cette question");
    const list = await bank.load([reading.id]);
    const index = list.findIndex((q) => q.id === questionId);
    if (index < 0) return ui.mountNotFound(`La question Q.${questionId} de ${reading.tag}`);
    question = list[index];
    neighbours = { previous: list[index - 1] || null, next: list[index + 1] || null };
    mount(`<div id="question"></div>`);
    render();
  }

  document.addEventListener("click", (event) => {
    if (!question) return;
    const choice = event.target.closest("[data-choice]");
    if (choice && !choice.disabled) {
      tried = choice.dataset.choice;
      return render();
    }
    if (event.target.closest("[data-q-reveal]")) {
      revealed = true;
      return render();
    }
    if (event.target.closest("[data-q-reset]")) {
      tried = null;
      revealed = false;
      render();
    }
  });

  // Marks and corpus links change elsewhere on the page (quiz-view.js): the history stays right.
  document.addEventListener("frm:change", () => {
    const card = question && document.querySelector("#question [data-history]");
    if (card) card.outerHTML = historyCard(); // absent while the page is being built
  });

  // The corpus manifest gives the entries linked to the question (chips under it).
  ui.loadScript("notes/corpus/index.js")
    .catch(() => {
      /* no corpus yet */
    })
    .then(start);
})(window.FRM, window.FRM.ui, window.FRM.quizView);
