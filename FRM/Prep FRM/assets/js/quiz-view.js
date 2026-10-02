/* Affichage d'une question AnalystPrep : énoncé, options, correction, marques, durées.
 * Pur HTML, sans état : la page Questions (pages/quiz.js) et la page Reading s'en servent. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const { store } = FRM;
  const LETTERS = ["A", "B", "C", "D"];

  // ------------------------------------------------------------------ durées

  const pad = (n) => String(n).padStart(2, "0");

  /** 83000 -> « 1:23 » ; au-delà d'une heure « 1:02:03 ». */
  function clock(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** 83000 -> « 1 min 23 s ». */
  function duration(ms) {
    if (ms === null || ms === undefined) return "—";
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h} h ${pad(m)}`;
    return m ? `${m} min ${pad(s)} s` : `${s} s`;
  }

  // ------------------------------------------------------------------ contenu

  /** Blocs extraits du PDF : paragraphes, ou calculs / tableaux en mise en page d'origine. */
  function blocks(list) {
    return list.map((b) => (b.type === "pre" ? `<pre class="q-pre">${esc(b.text)}</pre>` : `<p>${esc(b.text)}</p>`)).join("");
  }

  function sourceLink(question) {
    const reading = FRM.findReading(question.reading);
    const src = reading.questions.source;
    return ui.pdfLink(src, question.page, `${esc(FRM.sources[src].title)}, p. ${question.page}`);
  }

  function heading(question) {
    const reading = FRM.findReading(question.reading);
    return `<span class="ref-tag">${esc(reading.tag)}</span> ${esc(reading.title)} · Q.${esc(question.id)}`;
  }

  /** Options A–D. choice : réponse choisie ; reveal : afficher bonne / mauvaise réponse. */
  function options(question, { choice = null, reveal = false, locked = false } = {}) {
    const option = (letter) => {
      const isAnswer = letter === question.answer;
      const isChoice = letter === choice;
      const classes = ["q-option", isChoice && "is-chosen", reveal && isAnswer && "is-answer", reveal && isChoice && !isAnswer && "is-wrong"];
      const mark = reveal && isAnswer ? `<span class="q-mark">✓ Bonne réponse</span>` : reveal && isChoice ? `<span class="q-mark">✗ Ta réponse</span>` : "";
      return `
<button type="button" class="${classes.filter(Boolean).join(" ")}" data-choice="${letter}" aria-pressed="${isChoice}"${locked ? " disabled" : ""}>
  <span class="q-letter">${letter}</span>
  <span class="q-option-text">${blocks(question.options[letter])}${mark}</span>
</button>`;
    };
    return `<div class="q-options" role="group" aria-label="Réponses">${LETTERS.map(option).join("")}</div>`;
  }

  function verdict(question, choice) {
    if (!choice) return `<div class="q-verdict is-wrong">✗ Sans réponse · la bonne réponse est ${question.answer}</div>`;
    return choice === question.answer
      ? `<div class="q-verdict is-right">✓ Bonne réponse (${question.answer})</div>`
      : `<div class="q-verdict is-wrong">✗ Mauvaise réponse · tu as choisi ${choice}, la bonne réponse est ${question.answer}</div>`;
  }

  /** Correction : verdict, explication, « Things to Remember », renvoi au PDF. */
  function correction(question, choice) {
    const remember = question.remember.length
      ? `<div class="memo"><div class="lbl">Things to Remember</div><ul>${question.remember.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`
      : "";
    return `
<div class="q-correction">
  ${verdict(question, choice)}
  <div class="doc-text">${blocks(question.explanation)}</div>
  ${remember}
  <p class="src">Texte extrait du PDF : exposants et certaines formules peuvent être abîmés. Référence : ${sourceLink(question)}.</p>
</div>`;
  }

  // ------------------------------------------------------------------ marques

  function flagButtons(question) {
    const flags = store.flags.get(question.id);
    const button = (kind, icon) =>
      `<button type="button" class="toggle small" data-flag="${kind}" data-question="${esc(question.id)}" aria-pressed="${Boolean(flags[kind])}">${icon} ${esc(FRM.questions.FLAG_LABELS[kind])}</button>`;
    return `<div class="q-flags">${button("review", "🚩")}${button("unreadable", "⚠")}</div>`;
  }

  function flagIcons(questionId) {
    const flags = store.flags.get(questionId);
    return [flags.review && "🚩", flags.unreadable && "⚠"].filter(Boolean).join(" ");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-flag]");
    if (!button) return;
    store.flags.toggle(button.dataset.question, button.dataset.flag);
    button.setAttribute("aria-pressed", String(Boolean(store.flags.get(button.dataset.question)[button.dataset.flag])));
    ui.refresh();
  });

  FRM.quizView = { LETTERS, clock, duration, blocks, heading, sourceLink, options, correction, verdict, flagButtons, flagIcons };
})(window.FRM, window.FRM.ui);
