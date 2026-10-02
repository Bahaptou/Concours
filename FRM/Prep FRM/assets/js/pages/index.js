/* Accueil : résumé, prochaine étape, les 4 livres, sauvegarde, repères et sources. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;

  function summary() {
    const weights = FRM.books
      .map((b) => `${esc(ui.shortTitle(b))} ${ui.pdfLink(b.guide.source, b.guide.page, `${b.weight} %`)}`)
      .join(" · ");
    return `
<div class="card">
  <h2>Résumé</h2>
  <div class="stat-row">
    <div class="stat"><div class="num" data-pct="all"></div><div class="lbl">Avancement</div></div>
    <div class="stat"><div class="num" data-conf-pct="all"></div><div class="lbl">Confiance</div></div>
    <div class="stat"><div class="num" data-finished="all"></div><div class="lbl">Readings terminés</div></div>
    <div class="stat"><div class="num" data-rated="all"></div><div class="lbl">LOs notés</div></div>
    <div class="stat"><div class="num" data-q-seen="all"></div><div class="lbl">Questions vues</div></div>
    <div class="stat"><div class="num" data-q-rate="all"></div><div class="lbl">Réussite</div></div>
  </div>
  ${ui.meter("all", { large: true })}
  ${ui.meter("all", { large: true, kind: "confidence" })}
  <p class="src">Barre orange : avancement (étapes cochées). Barre bleue : confiance (notes des LOs sur 4).
  Chaque livre pèse son poids à l'examen (${esc(FRM.sources.studyGuide.title)}) : ${weights}. <a href="dashboard.html">Voir le dashboard</a>.</p>
</div>`;
  }

  function nextStep() {
    const next = FRM.nextStep();
    if (!next) return `<h2>Prochaine étape</h2><p>Les ${FRM.readings.length} readings sont terminés.</p>`;
    const { reading, step, book } = next;
    return `
<h2>Prochaine étape</h2>
<div class="next-step">
  <div>
    <div class="what">Livre ${book.id} · Chapitre ${reading.chapter} · étape ${step.n} : ${esc(step.label)}</div>
    <div class="title">${esc(reading.title)}</div>
  </div>
  <a class="btn" href="${ui.readingHref(reading)}">Ouvrir le reading</a>
</div>`;
  }

  function bookCard(book) {
    return `
<a class="book-card" href="${ui.bookHref(book)}">
  <span class="num">Livre ${book.id} · ${book.weight} % de l'examen</span>
  <h3>${esc(book.title)}</h3>
  <span class="meta">${ui.plural(book.readings.length, "reading")} · ${ui.plural(FRM.questionCount(book.readings), "question")} · <span data-finished="book:${book.id}"></span> terminés</span>
  ${ui.meter(`book:${book.id}`)}
  ${ui.meter(`book:${book.id}`, { kind: "confidence" })}
</a>`;
  }

  function saveCard() {
    return `
<div class="card" id="sauvegarde">
  <h2>Sauvegarde</h2>
  <p>Profil : <strong data-profile-name></strong> · <button type="button" class="link-btn" data-profile>modifier</button></p>
  <p>Profil, étapes et notes vivent dans ce navigateur. Exporte-les régulièrement dans le dossier <code>Prep FRM/save/</code> :
  un fichier JSON daté par export, à ton nom. Dernier export : <strong data-last-export></strong>.</p>
  <div class="save-actions">
    <button type="button" class="btn" data-export>💾 Sauvegarder</button>
    <button type="button" class="btn ghost" data-import>📂 Charger une sauvegarde</button>
    <button type="button" class="btn ghost" data-reset>🆕 Sauvegarde vierge</button>
  </div>
  <p class="small muted">Les mêmes boutons sont en haut de chaque page. Au premier export, choisis le dossier <code>save/</code> :
  Chrome et Edge le reproposent ensuite, aussi pour charger. Sur un navigateur sans ces fenêtres (Firefox), le fichier
  arrive dans Téléchargements : range-le dans <code>save/</code>. Charger remplace le profil, les étapes et les notes.</p>
  <p class="small muted"><strong>Voir la sauvegarde de quelqu'un d'autre sans perdre la sienne :</strong> ouvre le site dans une
  fenêtre de navigation privée (Ctrl+Maj+N) et charge-la là : son stockage est séparé et s'efface à la fermeture.</p>
  <p class="small muted"><strong>Démo :</strong> <code>save/exemple-demo.json</code> contient des données fictives pour voir les
  graphiques. Le plus simple : la charger dans une fenêtre privée.</p>
</div>`;
  }

  function method() {
    const steps = FRM.STEPS.map((s) => `<li><strong>${esc(s.label)}</strong> : ${esc(s.hint)}</li>`).join("");
    return `
<div class="card">
  <h2>La méthode</h2>
  <p>Pour chaque reading, quatre étapes à cocher. C'est notre façon de travailler, pas un contenu des documents.</p>
  <ol class="method">${steps}</ol>
  <p style="margin-top:10px">Chaque learning objective reçoit aussi une note de confiance sur 4 : ${ui.scoreLegend()}.
  Re-cliquer sur la note l'efface.</p>
</div>`;
  }

  function examApproach() {
    const { source, page, paragraphs } = FRM.examApproach;
    return `
<div class="card">
  <h2>L'examen selon GARP</h2>
  <div class="doc-text">${ui.docParagraphs(paragraphs)}</div>
  ${ui.source(source, page)}
</div>`;
  }

  function sources() {
    const items = Object.entries(FRM.sources).map(([key, s]) => {
      const details = [s.file, `${s.pages} pages`, s.updated ? `mis à jour ${s.updated}` : ""].filter(Boolean).join(" · ");
      return `
<div class="source-item">
  <div><div class="stitle">${esc(s.title)}</div><div class="sdesc">${esc(details)}</div></div>
  ${ui.pdfLink(key, 1, "Ouvrir")}
</div>`;
    });
    return `
<div class="card">
  <h2>Sources</h2>
  <p>Tout le programme affiché ici est extrait de ces documents (dossier <code>FRM/</code>).</p>
  <div class="source-list">${items.join("")}</div>
</div>`;
  }

  ui.mount({
    active: "home",
    body: `
${summary()}
<div class="card" id="next-step"></div>
<div class="cat"><h2>Les 4 livres</h2><span class="rule"></span></div>
<div class="book-grid">${FRM.books.map(bookCard).join("")}</div>
<div class="cat"><h2>Repères</h2><span class="rule"></span></div>
${saveCard()}
${method()}
${examApproach()}
${sources()}`,
  });

  const renderNextStep = () => (document.getElementById("next-step").innerHTML = nextStep());
  renderNextStep();
  document.addEventListener("frm:change", renderNextStep);
})(window.FRM, window.FRM.ui);
