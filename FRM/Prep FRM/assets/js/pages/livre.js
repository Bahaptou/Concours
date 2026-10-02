/* Page d'un livre (livre.html?id=N) : ce que couvre le livre selon le study guide,
 * puis la liste de ses readings avec leurs étapes à cocher. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const book = FRM.findBook(ui.queryId());
  if (!book) return ui.mountNotFound("Ce livre");

  function overview() {
    const { guide } = book;
    return `
<div class="card reading-head">
  <div class="kicker">Livre ${book.id} · ${book.weight} % de l'examen</div>
  <h2>${esc(book.title)}</h2>
  <div class="stat-row">
    <div class="stat"><div class="num">${book.readings.length}</div><div class="lbl">Readings</div></div>
    <div class="stat"><div class="num">${ui.number(FRM.questionCount(book.readings))}</div><div class="lbl">Questions AnalystPrep</div></div>
    <div class="stat"><div class="num" data-finished="book:${book.id}"></div><div class="lbl">Readings terminés</div></div>
    <div class="stat"><div class="num" data-rated="book:${book.id}"></div><div class="lbl">LOs notés</div></div>
    <div class="stat"><div class="num" data-q-seen="book:${book.id}"></div><div class="lbl">Questions vues</div></div>
    <div class="stat"><div class="num" data-q-rate="book:${book.id}"></div><div class="lbl">Réussite (dernier essai)</div></div>
  </div>
  <div class="save-actions"><a class="btn ghost" href="quiz.html?book=${book.id}">Lancer une série sur ce livre</a></div>
  ${ui.meter(`book:${book.id}`, { large: true })}
  ${ui.meter(`book:${book.id}`, { large: true, kind: "confidence" })}
  <p class="src">Barre orange : avancement. Barre bleue : confiance.</p>
</div>
<div class="card">
  <h2>Ce que couvre le livre</h2>
  <div class="doc-text">
    <p>${esc(guide.intro)}</p>
    ${ui.docList(guide.knowledgePoints)}
  </div>
  ${ui.source(guide.source, guide.page)}
</div>
<div class="card">
  <h2>Résumé du study guide</h2>
  <div class="doc-text">${ui.docParagraphs(guide.summary)}</div>
  ${ui.source(guide.source, guide.page, guide.lastPage)}
</div>`;
  }

  function readingRow(reading) {
    const { objectives: lo, questions: q } = reading;
    const meta = [
      esc(reading.tag),
      ui.pdfLink(lo.source, lo.page, `${ui.plural(lo.items.length, "LO")} p. ${lo.page}`),
      ui.pdfLink(q.source, q.firstPage, `${ui.plural(q.count, "question")} ${ui.pageRange(q.firstPage, q.lastPage)}`),
      `confiance <span data-conf-pct="reading:${reading.id}"></span>`,
      `vues <span data-q-seen="reading:${reading.id}"></span> · réussite <span data-q-rate="reading:${reading.id}"></span>`,
    ];
    return `
<div class="reading-row" data-complete="reading:${reading.id}">
  <span class="chap">${reading.chapter}</span>
  <div class="body">
    <a class="rtitle" href="${ui.readingHref(reading)}">${esc(reading.title)}</a>
    <div class="meta">${meta.join(" · ")}</div>
  </div>
  ${ui.stepChips(reading)}
</div>`;
  }

  ui.mount({
    active: `book:${book.id}`,
    title: book.title,
    trail: [{ label: "Accueil", href: "index.html" }, { label: `Livre ${book.id}` }],
    body: `
${overview()}
<div class="cat"><h2>Readings</h2><span class="rule"></span></div>
<p class="small muted">Étapes : ${ui.stepLegend()}</p>
<div class="reading-list">${book.readings.map(readingRow).join("")}</div>`,
  });
})(window.FRM, window.FRM.ui);
