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
    // "Traitée" is not a flag (a problem to look at again) but where the work on it stands.
    const treated = `<button type="button" class="toggle small treated-toggle" data-treated="${esc(question.id)}" data-reading="${question.reading}" aria-pressed="${store.treated.has(question.id)}" title="Question déjà exploitée (fiche, corpus)">✓ ${esc(FRM.questions.TREATED_LABEL)}</button>`;
    const link = withServer
      ? `<button type="button" class="toggle small" data-link-question="${esc(question.id)}" data-reading="${question.reading}" title="Relier la question à des entrées du corpus">📚 Corpus</button>`
      : "";
    return `<div class="q-flags">${button("review", "🚩")}${button("unreadable", "⚠")}${treated}${link}<span class="q-links" data-q-links="${esc(question.id)}">${linkChips(question.id)}</span></div>`;
  }

  // ------------------------------------------------------------------ liens avec le corpus
  // Stored in the corpus (entree.json, shared): read from the corpus manifest, written through the
  // server. The menu is the editors' one (ES modules, imported when needed: server only).

  const withServer = location.protocol.startsWith("http");

  const linkedEntries = (questionId) => FRM.corpusEntries().filter((entry) => (entry.questions || []).some((q) => q.id === String(questionId)));

  const linkChips = (questionId) =>
    linkedEntries(questionId)
      .map((entry) => `<a class="q-link-chip" href="${ui.entryHref(entry)}" title="Entrée du corpus liée à cette question">${ui.typeTag(entry.type)} ${esc(entry.titre)}</a>`)
      .join("");

  function refreshLinkChips(questionId) {
    document.querySelectorAll(`[data-q-links="${questionId}"]`).forEach((slot) => (slot.innerHTML = linkChips(questionId)));
  }

  /** Replaces the « 📚 Corpus » button by the corpus menu, opened: Lier / Délier on each entry. */
  async function openLinkMenu(button) {
    const questionId = button.dataset.linkQuestion;
    const reading = Number(button.dataset.reading);
    const moduleUrl = (path) => new URL(path, document.baseURI).href;
    const [{ corpusPicker }, api] = await Promise.all([import(moduleUrl("assets/js/editor/corpus-picker.js")), import(moduleUrl("assets/js/editor/api.js"))]);
    const isLinked = (entry) => (entry.questions || []).some((q) => q.id === questionId);
    const picker = corpusPicker(null, {
      label: "📚 Corpus",
      title: "Relier la question à des entrées du corpus",
      keepOpen: true,
      async load() {
        const entries = (await api.listCorpus()).data.entries;
        FRM.registerCorpus(Object.fromEntries(entries.map((entry) => [entry.id, entry])));
        refreshLinkChips(questionId);
        return entries;
      },
      actions: [
        {
          label: (entry) => (isLinked(entry) ? "Délier" : "Lier"),
          title: "Relier cette question à l'entrée, ou retirer le lien",
          run: (_, entry) => (isLinked(entry) ? api.unlinkQuestion(entry.id, questionId) : api.linkQuestion(entry.id, questionId, reading)),
        },
      ],
    });
    button.replaceWith(picker);
    picker.querySelector("button").click();
  }

  function flagIcons(questionId) {
    const flags = store.flags.get(questionId);
    return [flags.review && "🚩", flags.unreadable && "⚠", store.treated.has(questionId) && "✓"].filter(Boolean).join(" ");
  }

  document.addEventListener("click", (event) => {
    const linkButton = event.target.closest("[data-link-question]");
    if (linkButton) {
      openLinkMenu(linkButton).catch((error) => ui.flash(`Menu du corpus indisponible : ${error.message}`));
      return;
    }
    const treatedButton = event.target.closest("[data-treated]");
    if (treatedButton) {
      store.treated.toggle(treatedButton.dataset.treated, treatedButton.dataset.reading);
      treatedButton.setAttribute("aria-pressed", String(store.treated.has(treatedButton.dataset.treated)));
      document.dispatchEvent(new CustomEvent("frm:treated", { detail: { questionId: treatedButton.dataset.treated } }));
      ui.refresh();
      return;
    }
    const button = event.target.closest("[data-flag]");
    if (!button) return;
    store.flags.toggle(button.dataset.question, button.dataset.flag);
    button.setAttribute("aria-pressed", String(Boolean(store.flags.get(button.dataset.question)[button.dataset.flag])));
    ui.refresh();
  });

  FRM.quizView = { LETTERS, clock, duration, blocks, heading, sourceLink, options, correction, verdict, flagButtons, flagIcons };
})(window.FRM, window.FRM.ui);
