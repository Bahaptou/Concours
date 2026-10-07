/* Composants d'interface partagés : gabarit de page, indicateurs, cases à cocher,
 * notes de confiance, citations des PDFs, blocs de code, messages.
 *
 * Les indicateurs sont déclaratifs : un élément porte un attribut de INDICATORS
 * avec une portée ("all", "book:2", "reading:12"), et refresh() les met tous à
 * jour après chaque modification. */
(function (FRM) {
  "use strict";

  const { store } = FRM;

  // Libellés courts des onglets ; le titre complet reste en infobulle.
  const SHORT_TITLES = { 1: "Foundations", 2: "Quantitative Analysis", 3: "Markets & Products", 4: "Valuation & Risk" };

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  /** Lowercase without accents, for searches: "propriete" finds "Propriété". */
  const fold = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const number = (n, digits = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
  const plural = (n, word) => `${number(n)} ${word}${n > 1 ? "s" : ""}`;
  const percent = (ratio) => `${Math.round(ratio * 100)} %`;
  const dateTime = (iso) =>
    new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const shortTitle = (book) => SHORT_TITLES[book.id] || book.title;
  const bookHref = (book) => `livre.html?id=${book.id}`;
  const readingHref = (reading) => `reading.html?id=${reading.id}`;
  const entryHref = (entry) => `corpus.html?id=${encodeURIComponent(entry.id)}`;
  /** Coloured label of a corpus entry type (colours in style.css, .etype-<id>). */
  const typeTag = (typeId) => `<span class="etype etype-${typeId}">${esc(FRM.entryType(typeId).label)}</span>`;
  const queryId = () => new URLSearchParams(window.location.search).get("id");

  function pdfLink(sourceKey, page, label) {
    return `<a href="${FRM.pdfHref(sourceKey, page)}" target="_blank" rel="noopener">${label}</a>`;
  }

  const pageRange = (first, last) => (last && last !== first ? `p. ${first}–${last}` : `p. ${first}`);

  // ------------------------------------------------------------------ gabarit

  function header(active) {
    const tabs = [
      { key: "home", href: "index.html", label: "Accueil" },
      { key: "dashboard", href: "dashboard.html", label: "Dashboard" },
      { key: "quiz", href: "quiz.html", label: "Questions" },
      { key: "corpus", href: "corpus.html", label: "Corpus" },
      { key: "fiches", href: "fiches.html", label: "Fiches" },
      ...FRM.books.map((b) => ({ key: `book:${b.id}`, href: bookHref(b), label: `${b.id} · ${shortTitle(b)}`, title: b.title })),
    ];
    const links = tabs
      .map((t) => {
        const attrs = [`href="${t.href}"`, t.key === active ? 'class="active"' : "", t.title ? `title="${esc(t.title)}"` : ""];
        return `<a ${attrs.filter(Boolean).join(" ")}>${esc(t.label)}</a>`;
      })
      .join("");
    return `
<header class="top">
  <div class="top-inner">
    <div class="brand">
      <span class="kicker">Préparation FRM · Part I</span>
      <a href="index.html"><h1>Prep FRM</h1></a>
    </div>
    <div class="top-actions">
      <div class="progress-pill"><span class="dot"></span>Avancement&nbsp;<strong data-pct="all"></strong></div>
      <button type="button" class="save-btn" data-profile title="Modifier le profil">👤 <span data-profile-name></span></button>
      <button type="button" class="save-btn" data-export title="Exporter la sauvegarde JSON dans save/">💾 Sauvegarder</button>
      <button type="button" class="save-btn" data-import title="Charger une sauvegarde JSON">📂 Charger</button>
    </div>
  </div>
  <nav class="tabs">${links}</nav>
</header>`;
  }

  /** trail : [{ label, href }], le dernier élément est la page courante. */
  function crumbs(trail) {
    const parts = trail.map((item, i) =>
      i === trail.length - 1 ? `<span class="here">${esc(item.label)}</span>` : `<a href="${item.href}">${esc(item.label)}</a>`
    );
    return `<div class="crumb">${parts.join('<span class="sep">›</span>')}</div>`;
  }

  const FOOTER = `<footer class="note">Fonctionne hors ligne. Données enregistrées dans ce navigateur · dernier export : <span data-last-export></span>.</footer>`;

  function mount({ active, title, trail, body }) {
    document.title = title ? `${title} · Prep FRM` : "Prep FRM";
    document.getElementById("app").innerHTML = header(active) + (trail ? crumbs(trail) : "") + `<main>${body}</main>` + FOOTER;
    refresh();
  }

  function mountNotFound(what) {
    mount({
      active: "home",
      title: "Introuvable",
      body: `<div class="card"><h2>Introuvable</h2><p>${esc(what)} n'existe pas. <a href="index.html">Retour à l'accueil</a>.</p></div>`,
    });
  }

  // ------------------------------------------------------------------ indicateurs déclaratifs

  const setWidth = (el, ratio) => (el.firstElementChild.style.width = `${ratio * 100}%`);

  const INDICATORS = {
    "data-meter": (el, scope) => setWidth(el, FRM.completionOf(scope).ratio),
    "data-pct": (el, scope) => (el.textContent = percent(FRM.completionOf(scope).ratio)),
    "data-count": (el, scope) => {
      const c = FRM.completionOf(scope);
      el.textContent = `${c.done} / ${c.total}`;
    },
    "data-finished": (el, scope) => {
      const c = FRM.completionOf(scope);
      el.textContent = `${c.finished} / ${c.count}`;
    },
    "data-complete": (el, scope) => el.classList.toggle("is-complete", FRM.completionOf(scope).ratio === 1),
    "data-conf-meter": (el, scope) => setWidth(el, FRM.confidenceOfScope(scope).ratio),
    "data-conf-pct": (el, scope) => (el.textContent = percent(FRM.confidenceOfScope(scope).ratio)),
    "data-rated": (el, scope) => {
      const c = FRM.confidenceOfScope(scope);
      el.textContent = `${c.rated} / ${c.total}`;
    },
    "data-q-seen": (el, scope) => {
      const s = FRM.questions.statsOfScope(scope);
      el.textContent = `${s.seen} / ${s.total}`;
    },
    "data-q-rate": (el, scope) => {
      const s = FRM.questions.statsOfScope(scope);
      el.textContent = s.lastRate === null ? "—" : percent(s.lastRate);
    },
    "data-last-export": (el) => (el.textContent = store.lastExport() ? dateTime(store.lastExport()) : "jamais"),
    "data-profile-name": (el) => (el.textContent = store.profile.displayName() || "Qui es-tu ?"),
  };

  /** Recalcule tous les indicateurs de la page, puis prévient les pages (événement frm:change). */
  function refresh() {
    for (const [attr, apply] of Object.entries(INDICATORS)) {
      document.querySelectorAll(`[${attr}]`).forEach((el) => apply(el, el.getAttribute(attr)));
    }
    document.querySelectorAll("input[data-step]").forEach((input) => {
      input.checked = store.progress.isDone(input.dataset.reading, input.dataset.step);
    });
    document.querySelectorAll("[data-score-value]").forEach((button) => {
      const score = store.confidence.get(button.dataset.scoreReading, button.dataset.scoreLo);
      button.setAttribute("aria-pressed", String(score === Number(button.dataset.scoreValue)));
    });
    document.querySelectorAll("[data-score-label]").forEach((el) => {
      const [readingId, index] = el.dataset.scoreLabel.split(":");
      const score = store.confidence.get(readingId, index);
      el.textContent = score === null ? "Non noté" : FRM.SCORE_LEVELS[score].label;
      el.classList.toggle("is-empty", score === null);
    });
    document.dispatchEvent(new CustomEvent("frm:change"));
  }

  /** Barre de progression ; kind "confidence" pour la confiance. */
  function meter(scope, { large = false, kind = "progress" } = {}) {
    const conf = kind === "confidence";
    return `
<div class="meter-row">
  <div class="meter${large ? " lg" : ""}${conf ? " conf" : ""}" ${conf ? "data-conf-meter" : "data-meter"}="${scope}"><div class="meter-fill"></div></div>
  <span class="pct" ${conf ? "data-conf-pct" : "data-pct"}="${scope}"></span>
</div>`;
  }

  // ------------------------------------------------------------------ étapes

  /** Pastilles ①②③④, pour les listes de readings. */
  function stepChips(reading) {
    const chips = FRM.STEPS.map(
      (s) => `
  <label class="chip-box" title="${esc(`${s.n}. ${s.label}`)}">
    <input type="checkbox" data-reading="${reading.id}" data-step="${s.id}" aria-label="${esc(`${reading.title} : ${s.label}`)}">
    <span class="chip">${s.n}</span>
  </label>`
    );
    return `<div class="chips">${chips.join("")}</div>`;
  }

  /** Cases détaillées avec consigne, pour la page d'un reading. */
  function stepList(reading) {
    return FRM.STEPS.map((s) => {
      const id = `step-${reading.id}-${s.id}`;
      return `
<div class="check-item">
  <input type="checkbox" id="${id}" data-reading="${reading.id}" data-step="${s.id}">
  <label for="${id}"><div class="ctitle">${s.n}. ${esc(s.label)}</div><div class="cdesc">${esc(s.hint)}</div></label>
</div>`;
    }).join("");
  }

  const stepLegend = () => FRM.STEPS.map((s) => `${s.n}. ${esc(s.label)}`).join(" · ");

  // ------------------------------------------------------------------ notes de confiance

  function scoreControl(reading, index) {
    const buttons = FRM.SCORE_LEVELS.map(
      (level) => `
    <button type="button" class="score-btn" data-score-reading="${reading.id}" data-score-lo="${index}" data-score-value="${level.value}"
            title="${level.value} / 4 · ${esc(level.label)}" aria-label="${esc(`Confiance ${level.value} sur 4 : ${level.label}`)}">${level.value}</button>`
    );
    return `
<div class="lo-score">
  <div class="score" role="group" aria-label="Confiance sur 4">${buttons.join("")}</div>
  <span class="score-label" data-score-label="${reading.id}:${index}"></span>
</div>`;
  }

  const scoreLegend = () => FRM.SCORE_LEVELS.map((l) => `${l.value} ${esc(l.label)}`).join(" · ");

  /** Learning objectives d'un reading, chacun avec sa note sur 4. */
  function objectiveList(reading) {
    const items = reading.objectives.items.map(
      (item, index) => `
<li class="lo">
  <div class="lo-body">
    <div class="lo-text">${esc(item.text)}${item.sub ? docList(item.sub) : ""}</div>
    ${scoreControl(reading, index)}
  </div>
</li>`
    );
    return `<ol class="lo-list">${items.join("")}</ol>`;
  }

  // ------------------------------------------------------------------ texte des PDFs

  function sourceLink(sourceKey, page, lastPage) {
    return pdfLink(sourceKey, page, `${esc(FRM.sources[sourceKey].title)}, ${pageRange(page, lastPage)}`);
  }

  const source = (sourceKey, page, lastPage) => `<p class="src">Source : ${sourceLink(sourceKey, page, lastPage)}</p>`;
  const docParagraphs = (paragraphs) => paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");

  /** items : chaînes ou { text, sub: [chaînes] }. */
  function docList(items) {
    const li = (item) => {
      const { text, sub } = typeof item === "string" ? { text: item } : item;
      return `<li>${esc(text)}${sub ? docList(sub) : ""}</li>`;
    };
    return `<ul>${items.map(li).join("")}</ul>`;
  }

  // ------------------------------------------------------------------ code

  function codeBlock(code, language = "python") {
    return `
<div class="code-wrap">
  <button type="button" class="copy-btn" data-copy>Copier</button>
  <pre class="code-block"><code class="language-${language}">${esc(code.trim())}</code></pre>
</div>`;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
  }

  /** Charge un script optionnel (ex. notes/index.js) ; rejette s'il n'existe pas. */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement("script"), { src, onload: resolve, onerror: reject });
      document.body.appendChild(script);
    });
  }

  // ------------------------------------------------------------------ message éphémère

  let flashTimer = null;

  function flash(text, kind = "info") {
    let box = document.querySelector(".flash");
    if (!box) {
      box = Object.assign(document.createElement("div"), { className: "flash" });
      box.setAttribute("role", "status");
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.dataset.kind = kind;
    box.classList.add("is-visible");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => box.classList.remove("is-visible"), 4000);
  }

  // ------------------------------------------------------------------ "Entrées liées" control (see FRM.linkedTo)

  /** How far to look for entries linked to the results: a number of steps (0: none) or "Max"
   *  (the whole chain, depth Infinity). The number is kept while "Max" is on. */
  function linkedControl(depth) {
    const max = depth === Infinity;
    return `<span class="linked-control" title="Ajoute les entrées liées aux résultats (citations et imports de code, dans les deux sens), en grisé : 0 = aucune, 1 = voisins directs, 2 = leurs voisins aussi… Max = toute la chaîne. Le type et l'auteur choisis s'appliquent à elles aussi.">
  <span class="filter-label">Entrées liées</span>
  <span class="small">jusqu'à</span><input type="number" class="linked-depth" data-linked-depth min="0" max="99" step="1" value="${max ? 1 : depth}"${max ? " disabled" : ""} aria-label="Distance maximale en liens"><span class="small">lien(s)</span>
  <button type="button" class="toggle small" data-linked-max aria-pressed="${max}">Max</button>
</span>`;
  }

  /** Calls onChange(depth) whenever a linkedControl inside `root` changes. */
  function watchLinkedControl(root, onChange) {
    const read = (control) => {
      if (control.querySelector("[data-linked-max]").getAttribute("aria-pressed") === "true") return Infinity;
      const value = Math.floor(Number(control.querySelector("[data-linked-depth]").value));
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    root.addEventListener("input", (event) => {
      const input = event.target.closest("[data-linked-depth]");
      if (input) onChange(read(input.closest(".linked-control")));
    });
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-linked-max]");
      if (!button) return;
      const control = button.closest(".linked-control");
      const max = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(max));
      control.querySelector("[data-linked-depth]").disabled = max;
      onChange(read(control));
    });
  }

  // ------------------------------------------------------------------ multi-select toggles (FRM.toggleChoice)

  /** A row of multi-select toggles for filters[key] (null: everything, or a Set); options are
   *  { value, label, title?, className? }, "all" first. */
  function choiceToggles(key, selection, options, { small = false } = {}) {
    return options
      .map((o) => {
        const value = String(o.value);
        const pressed = value === "all" ? selection === null : FRM.isChosen(selection, value);
        return `<button type="button" class="toggle${small ? " small" : ""}${o.className || ""}" data-multi-filter="${key}" data-value="${esc(value)}" aria-pressed="${pressed}"${o.title ? ` title="${esc(o.title)}"` : ""}>${esc(o.label)}</button>`;
      })
      .join("");
  }

  /** Clicks on choiceToggles inside `root`: updates filters[key] and the pressed states, then calls
   *  onChange(key). The available values are those of the row's buttons. */
  function watchChoiceToggles(root, filters, onChange) {
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-multi-filter]");
      if (!button || !root.contains(button)) return;
      const key = button.dataset.multiFilter;
      const row = [...root.querySelectorAll(`[data-multi-filter="${key}"]`)];
      const available = row.map((b) => b.dataset.value).filter((value) => value !== "all");
      filters[key] = FRM.toggleChoice(filters[key], button.dataset.value, available);
      row.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === "all" ? filters[key] === null : FRM.isChosen(filters[key], b.dataset.value))));
      onChange(key);
    });
  }

  // ------------------------------------------------------------------ journals of the shared notes and entries

  const day = (ms) => new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

  /** "Créée par Baptiste Durand le 7 oct. 2026 · modifiée par Marie Martin (3 séances, la dernière
   *  le 9 oct. 2026)": who created and changed a shared note or entry (both feminine), from its
   *  journal. The creation session does not count as a change. "" without a journal. */
  function journalLine(journal) {
    const { creator, contributors } = FRM.journalSummary(journal);
    if (!creator) return "";
    const changes = contributors
      .map((c) => ({ ...c, sessions: c.sessions - (c.creator ? 1 : 0) }))
      .filter((c) => c.sessions > 0)
      .map((c) => `${esc(c.name)} (${c.sessions > 1 ? `${c.sessions} séances, la dernière` : "1 séance,"} le ${day(c.last)})`);
    return `Créée par ${esc(creator.name)} le ${day(creator.at)}${changes.length ? ` · modifiée par ${changes.join(", ")}` : ""}`;
  }

  /** Initials of everyone who created or changed it, the creator first; the title says who did what. */
  function contributorBadges(journal) {
    return FRM.journalSummary(journal)
      .contributors.map((c) => {
        const what = c.creator ? `créée par ${c.name}${c.sessions > 1 ? `, puis ${c.sessions - 1} séance${c.sessions > 2 ? "s" : ""}` : ""}` : `${c.name} : ${plural(c.sessions, "séance")}`;
        return `<span class="initials${c.creator ? " is-creator" : ""}" title="${esc(what)}">${esc(c.initials)}</span>`;
      })
      .join("");
  }

  // ------------------------------------------------------------------ comportements globaux

  document.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-step]");
    if (!input) return;
    store.progress.set(input.dataset.reading, input.dataset.step, input.checked);
    refresh();
  });

  document.addEventListener("click", (event) => {
    const scoreButton = event.target.closest("[data-score-value]");
    if (scoreButton) {
      const { scoreReading, scoreLo, scoreValue } = scoreButton.dataset;
      const value = Number(scoreValue);
      const current = store.confidence.get(scoreReading, scoreLo);
      store.confidence.set(scoreReading, scoreLo, current === value ? null : value); // re-cliquer efface
      refresh();
      return;
    }
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) {
      const code = copyButton.closest(".code-wrap").querySelector("code").textContent;
      copyText(code).then(() => {
        copyButton.textContent = "Copié ✓";
        setTimeout(() => (copyButton.textContent = "Copier"), 1500);
      });
    }
  });

  // Modification faite dans un autre onglet : on se resynchronise.
  window.addEventListener("storage", (event) => {
    if (event.key !== store.storageKey) return;
    store.reload();
    refresh();
  });

  FRM.ui = {
    esc,
    fold,
    number,
    plural,
    percent,
    dateTime,
    shortTitle,
    bookHref,
    readingHref,
    entryHref,
    typeTag,
    queryId,
    pdfLink,
    pageRange,
    mount,
    mountNotFound,
    refresh,
    meter,
    stepChips,
    stepList,
    stepLegend,
    scoreLegend,
    objectiveList,
    sourceLink,
    source,
    docParagraphs,
    docList,
    codeBlock,
    loadScript,
    flash,
    linkedControl,
    watchLinkedControl,
    choiceToggles,
    watchChoiceToggles,
    journalLine,
    contributorBadges,
  };
})(window.FRM);
