/* Graphiques du dashboard, en SVG et HTML écrits à la main : aucune bibliothèque,
 * le site doit marcher hors ligne.
 *
 * Règles suivies (skill dataviz) : couleurs par rôle définies en CSS (--viz-*,
 * --score-*, validées pour les deux thèmes), légende dès deux séries, texte
 * jamais coloré par la série, info-bulle au survol et au focus clavier, et une
 * vue tableau pour chaque graphique (dashboard.js). */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const fmt = (n) => n.toFixed(1);

  // ------------------------------------------------------------------ info-bulle

  const tips = new Map();

  /** Enregistre le contenu d'une info-bulle et renvoie l'id à poser en data-tip.
   *  content : { title, rows: [{ key: classe de la pastille, value, label }] } */
  function tip(content) {
    const id = `tip-${tips.size}`;
    tips.set(id, content);
    return id;
  }

  const bubble = Object.assign(document.createElement("div"), { className: "viz-tip", hidden: true });
  document.body.appendChild(bubble);

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text; // textContent : jamais de HTML injecté
    return el;
  }

  function showTip(target, x, y) {
    const content = tips.get(target.dataset.tip);
    if (!content) return;
    bubble.replaceChildren(node("div", "tip-title", content.title));
    for (const row of content.rows) {
      const line = node("div", "tip-row");
      line.append(node("span", `tip-key ${row.key}`), node("strong", "", row.value), node("span", "tip-label", row.label));
      bubble.append(line);
    }
    bubble.hidden = false;
    const { width, height } = bubble.getBoundingClientRect();
    const left = Math.min(x + 14, window.innerWidth - width - 8);
    const top = y + 14 + height > window.innerHeight ? y - height - 14 : y + 14;
    bubble.style.left = `${Math.max(8, left)}px`;
    bubble.style.top = `${Math.max(8, top)}px`;
  }

  const hideTip = () => (bubble.hidden = true);

  document.addEventListener("pointermove", (event) => {
    const target = event.target.closest("[data-tip]");
    if (target) showTip(target, event.clientX, event.clientY);
    else hideTip();
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest("[data-tip]");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    showTip(target, rect.right, rect.top);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("scroll", hideTip, { passive: true });

  // ------------------------------------------------------------------ légende

  /** items : [{ key, label, className, shape: "line" | "rect", hidden }]
   *  toggle : chaque entrée devient un bouton data-series-toggle qui masque la série. */
  function legend(items, { toggle = false } = {}) {
    const entry = (item) => {
      const key = `<span class="key ${item.shape} ${item.className}"></span>${esc(item.label)}`;
      return toggle
        ? `<button type="button" class="legend-item" data-series-toggle="${item.key}" aria-pressed="${!item.hidden}">${key}</button>`
        : `<span class="legend-item">${key}</span>`;
    };
    return `<div class="legend">${items.map(entry).join("")}</div>`;
  }

  // ------------------------------------------------------------------ toile d'araignée

  const RADIUS = 200;
  const FEW_AXES = 6; // jusque-là, étiquettes horizontales sur deux lignes ; au-delà, rayonnantes
  const CHAR_WIDTH = 0.56; // largeur moyenne d'un caractère, en fraction de la taille de police

  /** Coupe au dernier mot entier avant `max` caractères ; le titre complet reste en info-bulle et en tableau. */
  function shorten(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,:;(–-]+$/, "")}…`;
  }

  const textWidth = (chars, fontSize) => chars * fontSize * CHAR_WIDTH;

  /** Étiquettes horizontales (peu d'axes) : référence au-dessus, nom complet dessous.
   *  Renvoie les étiquettes et les coins de la zone qu'elles occupent (pour le viewBox). */
  function flatLabels(axes, at, angle) {
    const fontSize = 13;
    const corners = [];
    const labels = axes.map((axis, i) => {
      const cos = Math.cos(angle(i));
      const sin = Math.sin(angle(i));
      const [x, y] = at(i, RADIUS + 14);
      const anchor = cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle";
      const place = sin > 0.2 ? "below" : sin < -0.2 ? "above" : "side"; // bloc de deux lignes hors du cercle
      const firstDy = { below: "0.9em", above: "-1.45em", side: "-0.3em" }[place];

      const w = textWidth(Math.max(axis.ref.length, axis.name.length), fontSize);
      const left = { start: x, end: x - w, middle: x - w / 2 }[anchor];
      const [top, bottom] = { below: [y, y + 2.5 * fontSize], above: [y - 2.5 * fontSize, y], side: [y - 1.3 * fontSize, y + 1.3 * fontSize] }[place];
      corners.push([left, top], [left + w, bottom]);

      return `
<text class="radar-label" font-size="${fontSize}" x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}">
  <tspan class="radar-ref" x="${fmt(x)}" dy="${firstDy}">${esc(axis.ref)}</tspan><tspan x="${fmt(x)}" dy="1.25em">${esc(axis.name)}</tspan>
</text>`;
    });
    return { labels, corners };
  }

  /** Étiquettes rayonnantes (beaucoup d'axes) : « référence · nom », nom raccourci si besoin. */
  function radialLabels(axes, at, angle) {
    const fontSize = axes.length > 24 ? 10 : 11.5;
    const maxChars = axes.length > 24 ? 32 : 44;
    const corners = [];
    const labels = axes.map((axis, i) => {
      const name = shorten(axis.name, maxChars - axis.ref.length - 3);
      const [x, y] = at(i, RADIUS + 8);
      const [xEnd, yEnd] = at(i, RADIUS + 8 + textWidth(axis.ref.length + 3 + name.length, fontSize));
      corners.push([xEnd - fontSize / 2, yEnd - fontSize / 2], [xEnd + fontSize / 2, yEnd + fontSize / 2]);

      const flip = Math.cos(angle(i)) < -1e-9; // côté gauche : on retourne le texte pour qu'il se lise
      const deg = (angle(i) * 180) / Math.PI + (flip ? 180 : 0);
      return `
<text class="radar-label" font-size="${fontSize}" x="${fmt(x)}" y="${fmt(y)}" dy="0.35em" text-anchor="${flip ? "end" : "start"}"
      transform="rotate(${fmt(deg)} ${fmt(x)} ${fmt(y)})"><tspan class="radar-ref">${esc(axis.ref)}</tspan> · ${esc(name)}</text>`;
    });
    return { labels, corners };
  }

  /** viewBox serré autour du cercle (cibles de survol comprises) et des étiquettes. */
  function viewBox(corners, radius, pad = 8) {
    const points = [[-radius, -radius], [radius, radius], ...corners];
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const [minX, minY] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
    return [minX, minY, Math.max(...xs) + pad - minX, Math.max(...ys) + pad - minY].map(fmt).join(" ");
  }

  /** axes   : [{ ref, name, values: { <clé de série>: 0..1 }, details: lignes d'info-bulle }]
   *  series : [{ key, className }] séries visibles, dans l'ordre des couleurs. */
  function radar({ axes, series }) {
    if (axes.length < 3) {
      return `<div class="placeholder">La toile a besoin d'au moins trois axes : ajoute des livres ou passe au détail par reading.</div>`;
    }
    const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / axes.length;
    const at = (i, r) => [r * Math.cos(angle(i)), r * Math.sin(angle(i))];
    const points = (list) => list.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
    const ringAt = (t) => points(axes.map((_, i) => at(i, RADIUS * t)));
    const levels = [0.25, 0.5, 0.75, 1];

    // Secteurs invisibles, un par axe : la cible du survol est plus large que la marque.
    const half = Math.PI / axes.length;
    const hitRadius = RADIUS + 24;
    const hits = axes.map((axis, i) => {
      const [x0, y0] = [hitRadius * Math.cos(angle(i) - half), hitRadius * Math.sin(angle(i) - half)];
      const [x1, y1] = [hitRadius * Math.cos(angle(i) + half), hitRadius * Math.sin(angle(i) + half)];
      const d = `M0,0 L${fmt(x0)},${fmt(y0)} A${hitRadius},${hitRadius} 0 0,1 ${fmt(x1)},${fmt(y1)} Z`;
      const title = `${axis.ref} · ${axis.name}`;
      return `<path class="radar-hit" d="${d}" tabindex="0" aria-label="${esc(title)}" data-tip="${tip({ title, rows: axis.details })}"/>`;
    });

    const rings = levels.map((t) => `<polygon class="radar-ring" points="${ringAt(t)}"/>`);
    const spokes = axes.map((_, i) => {
      const [x, y] = at(i, RADIUS);
      return `<line class="radar-spoke" x1="0" y1="0" x2="${fmt(x)}" y2="${fmt(y)}"/>`;
    });
    // Graduations juste sous chaque anneau : l'extérieur reste libre pour les étiquettes d'axes.
    const ticks = levels.map((t) => `<text class="radar-tick" x="4" y="${fmt(-RADIUS * t + 11)}">${t * 100} %</text>`);

    const shapes = series.map((s) => {
      const pts = axes.map((axis, i) => at(i, RADIUS * axis.values[s.key]));
      const dots = pts.map(([x, y]) => `<circle class="radar-dot ${s.className}" cx="${fmt(x)}" cy="${fmt(y)}" r="4"/>`);
      return `<polygon class="radar-area ${s.className}" points="${points(pts)}"/>${dots.join("")}`;
    });

    const flat = axes.length <= FEW_AXES;
    const { labels, corners } = (flat ? flatLabels : radialLabels)(axes, at, angle);
    return `
<svg class="radar" viewBox="${viewBox(corners, hitRadius)}" role="img" aria-label="Toile d'araignée, ${axes.length} axes">
  ${hits.join("")}${rings.join("")}${spokes.join("")}${shapes.join("")}${ticks.join("")}${labels.join("")}
</svg>`;
  }

  // ------------------------------------------------------------------ répartition des notes

  const SCORE_KEYS = () => [
    ...FRM.SCORE_LEVELS.map((l) => ({ key: `score-${l.value}`, label: `${l.value} · ${l.label}`, count: (c) => c.histogram[l.value] })),
    { key: "score-none", label: "Non noté", count: (c) => c.unrated },
  ];

  const scoreLegendItems = () =>
    SCORE_KEYS().map((s) => ({ key: s.key, label: s.label, className: s.key, shape: "rect" }));

  /** Barres empilées à 100 % : une ligne par unité (livre ou reading).
   *  rows : [{ ref, name, href, conf: FRM.confidenceOf(...) }] */
  function scoreBars(rows) {
    const line = (row) => {
      const c = row.conf;
      const title = `${row.ref} · ${row.name}`;
      const segments = SCORE_KEYS()
        .map((s) => ({ ...s, n: s.count(c) }))
        .filter((s) => s.n > 0)
        .map((s) => {
          const id = tip({ title, rows: [{ key: s.key, value: ui.plural(s.n, "LO"), label: `${s.label} · ${ui.percent(s.n / c.total)}` }] });
          return `<span class="seg ${s.key}" style="flex-grow:${s.n}" data-tip="${id}"></span>`;
        });
      const mean = c.mean === null ? "—" : `${ui.number(c.mean, 1)} / 4`;
      return `
<div class="bar-row">
  <a class="bar-label" href="${row.href}" title="${esc(title)}"><span class="ref-tag">${esc(row.ref)}</span> ${esc(row.name)}</a>
  <div class="stack">${segments.join("")}</div>
  <span class="bar-value">${mean}</span>
</div>`;
    };
    return `<div class="bars">${rows.map(line).join("")}</div>`;
  }

  // ------------------------------------------------------------------ carte des étapes

  /** Une ligne par reading : une case par étape, puis la confiance moyenne arrondie.
   *  groups : [{ title, rows: [{ reading, steps: [booléens], conf }] }] */
  function stepMap(groups) {
    const head = `
<div class="map-row map-head">
  <span></span>${FRM.STEPS.map((s) => `<span class="map-col" title="${esc(s.label)}">${s.n}</span>`).join("")}
  <span class="map-col" title="Confiance moyenne">C</span>
</div>`;
    const line = ({ reading, steps, conf }) => {
      const title = `${reading.tag} · ${reading.title}`;
      const stepCells = FRM.STEPS.map((s, i) => {
        const id = tip({ title, rows: [{ key: steps[i] ? "done" : "todo", value: steps[i] ? "Fait" : "À faire", label: `${s.n}. ${s.label}` }] });
        return `<span class="cell ${steps[i] ? "done" : "todo"}" data-tip="${id}"></span>`;
      });
      const bucket = conf.mean === null ? "score-none" : `score-${Math.round(conf.mean)}`;
      const value = conf.mean === null ? "Non noté" : `${ui.number(conf.mean, 1)} / 4`;
      const confId = tip({ title, rows: [{ key: bucket, value, label: `confiance moyenne · ${conf.rated}/${conf.total} LOs notés` }] });
      return `
<div class="map-row">
  <a class="map-label" href="${ui.readingHref(reading)}" title="${esc(title)}"><span class="ref-tag">${esc(reading.tag)}</span> ${esc(reading.title)}</a>
  ${stepCells.join("")}<span class="cell conf-cell ${bucket}" data-tip="${confId}"></span>
</div>`;
    };
    const body = groups.map((g) => `<div class="map-group">${esc(g.title)}</div>${g.rows.map(line).join("")}`);
    return `<div class="step-map">${head}${body.join("")}</div>`;
  }

  // ------------------------------------------------------------------ haltères : 1er essai -> dernier essai

  const pctPos = (ratio) => `${(ratio * 100).toFixed(2)}%`;

  /** Réussite au premier puis au dernier essai, sur les questions vues.
   *  rows : [{ ref, name, href, stats: FRM.questions.statsOf(...) }] */
  function dumbbells(rows) {
    const axis = `
<div class="dumb-row dumb-axis"><span></span>
  <div class="dumb-scale">${[0, 25, 50, 75, 100].map((t) => `<span style="left:${t}%">${t} %</span>`).join("")}</div><span></span>
</div>`;
    const line = (row) => {
      const s = row.stats;
      const title = `${row.ref} · ${row.name}`;
      const label = `<a class="bar-label" href="${row.href}" title="${esc(title)}"><span class="ref-tag">${esc(row.ref)}</span> ${esc(row.name)}</a>`;
      if (!s.seen) return `<div class="dumb-row">${label}<div class="dumb-track"></div><span class="bar-value">aucune vue</span></div>`;
      const [lo, hi] = [Math.min(s.firstRate, s.lastRate), Math.max(s.firstRate, s.lastRate)];
      const id = tip({
        title,
        rows: [
          { key: "dumb-first", value: ui.percent(s.firstRate), label: "réussite au 1er essai" },
          { key: "s-quiz", value: ui.percent(s.lastRate), label: "réussite au dernier essai" },
          { key: "todo", value: `${s.seen} / ${s.total}`, label: `questions vues · ${ui.plural(s.attempts, "essai")}` },
        ],
      });
      return `
<div class="dumb-row">
  ${label}
  <div class="dumb-track" data-tip="${id}">
    <span class="dumb-link" style="left:${pctPos(lo)}; width:${pctPos(hi - lo)}"></span>
    <span class="dumb-dot dumb-first" style="left:${pctPos(s.firstRate)}"></span>
    <span class="dumb-dot s-quiz" style="left:${pctPos(s.lastRate)}"></span>
  </div>
  <span class="bar-value">${s.seen} / ${s.total}</span>
</div>`;
    };
    return `<div class="dumbbells">${axis}${rows.map(line).join("")}</div>`;
  }

  // ------------------------------------------------------------------ courbe : score par série

  /** points : [{ at, rate, n, correct, label, mode, avgMs }] dans l'ordre chronologique. */
  function lineChart(points) {
    if (points.length < 2) return `<div class="placeholder">Il faut au moins deux séries pour tracer une évolution.</div>`;
    const W = 800;
    const H = 260;
    const m = { top: 14, right: 46, bottom: 30, left: 44 };
    const step = (W - m.left - m.right) / (points.length - 1);
    const x = (i) => m.left + i * step;
    const y = (v) => m.top + (1 - v) * (H - m.top - m.bottom);
    const grid = [0, 0.25, 0.5, 0.75, 1].map(
      (t) => `<line class="grid-line" x1="${m.left}" x2="${W - m.right}" y1="${fmt(y(t))}" y2="${fmt(y(t))}"/>
<text class="axis-label" x="${m.left - 8}" y="${fmt(y(t))}" dy="0.35em" text-anchor="end">${t * 100} %</text>`
    );
    const every = Math.max(1, Math.ceil(points.length / 8));
    const day = (at) => new Date(at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    const xLabels = points
      .map((p, i) => (i % every === 0 || i === points.length - 1 ? `<text class="axis-label" x="${fmt(x(i))}" y="${H - 8}" text-anchor="middle">${day(p.at)}</text>` : ""))
      .join("");
    const path = points.map((p, i) => `${i ? "L" : "M"}${fmt(x(i))},${fmt(y(p.rate))}`).join(" ");
    const dots = points.map((p, i) => `<circle class="line-dot" cx="${fmt(x(i))}" cy="${fmt(y(p.rate))}" r="4"/>`).join("");
    // Une colonne invisible par série : la cible du survol trouve le point le plus proche en x.
    const hits = points
      .map((p, i) => {
        const id = tip({
          title: `${ui.dateTime(p.at)} · ${p.mode === "exam" ? "examen" : p.mode === "training" ? "entraînement" : "série"}`,
          rows: [
            { key: "s-quiz", value: ui.percent(p.rate), label: `${p.correct} / ${p.n} justes` },
            { key: "todo", value: p.avgMs === null ? "—" : FRM.quizView.clock(p.avgMs), label: "par question" },
          ],
        });
        const left = i === 0 ? m.left : x(i) - step / 2;
        const right = i === points.length - 1 ? W - m.right : x(i) + step / 2;
        return `<rect class="line-hit" x="${fmt(left)}" y="${m.top}" width="${fmt(right - left)}" height="${H - m.top - m.bottom}" tabindex="0" data-tip="${id}" aria-label="${esc(p.label)}"/>`;
      })
      .join("");
    const last = points[points.length - 1];
    const endLabel = `<text class="line-end" x="${fmt(x(points.length - 1) + 8)}" y="${fmt(y(last.rate))}" dy="0.35em">${ui.percent(last.rate)}</text>`;
    return `
<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score par série, ${points.length} séries">
  ${grid.join("")}${hits}<path class="line-path" d="${path}"/>${dots}${endLabel}${xLabels}
</svg>`;
  }

  // ------------------------------------------------------------------ nuage : confiance vs réussite

  /** points : [{ ref, name, href, x: confiance 0..1, y: réussite 0..1, detail }] */
  function scatter(points) {
    if (!points.length) return `<div class="placeholder">Il faut des readings avec à la fois des LOs notés et des questions vues.</div>`;
    const S = 420;
    const m = { top: 12, right: 16, bottom: 44, left: 52 };
    const size = S - m.left - m.right;
    const px = (v) => m.left + v * size;
    const py = (v) => m.top + (1 - v) * size;
    const H = m.top + size + m.bottom;
    const ticks = [0, 0.25, 0.5, 0.75, 1];
    const grid = ticks
      .map(
        (t) => `<line class="grid-line" x1="${fmt(px(t))}" x2="${fmt(px(t))}" y1="${m.top}" y2="${fmt(py(0))}"/>
<line class="grid-line" x1="${m.left}" x2="${fmt(px(1))}" y1="${fmt(py(t))}" y2="${fmt(py(t))}"/>
<text class="axis-label" x="${fmt(px(t))}" y="${fmt(py(0) + 16)}" text-anchor="middle">${t * 100} %</text>
<text class="axis-label" x="${m.left - 8}" y="${fmt(py(t))}" dy="0.35em" text-anchor="end">${t * 100} %</text>`
      )
      .join("");
    // Étiquettes directes : toutes s'il y a peu de points, sinon les trois plus grands écarts.
    const labelled = points.length <= 6 ? points : [...points].sort((a, b) => Math.abs(b.y - b.x) - Math.abs(a.y - a.x)).slice(0, 3);
    const dots = points
      .map((p) => {
        const id = tip({
          title: `${p.ref} · ${p.name}`,
          rows: [
            { key: "s-conf", value: ui.percent(p.x), label: "confiance (LOs notés)" },
            { key: "s-quiz", value: ui.percent(p.y), label: "réussite au dernier essai" },
            { key: "todo", value: `${p.y >= p.x ? "+" : "−"}${Math.round(Math.abs(p.y - p.x) * 100)} pts`, label: p.y >= p.x ? "tu te sous-estimes" : "tu te surestimes" },
          ],
        });
        const label = labelled.includes(p) ? `<text class="scatter-label" x="${fmt(px(p.x) + 8)}" y="${fmt(py(p.y))}" dy="0.35em">${esc(p.ref)}</text>` : "";
        return `<circle class="scatter-dot" cx="${fmt(px(p.x))}" cy="${fmt(py(p.y))}" r="5"/>${label}
<circle class="scatter-hit" cx="${fmt(px(p.x))}" cy="${fmt(py(p.y))}" r="12" tabindex="0" data-tip="${id}" aria-label="${esc(`${p.ref} · ${p.name}`)}"/>`;
      })
      .join("");
    return `
<svg class="scatter" viewBox="0 0 ${S} ${H}" role="img" aria-label="Confiance et réussite, ${points.length} points">
  ${grid}
  <line class="diag-line" x1="${fmt(px(0))}" y1="${fmt(py(0))}" x2="${fmt(px(1))}" y2="${fmt(py(1))}"/>
  <text class="zone-label" x="${fmt(px(0.03))}" y="${fmt(py(0.95))}">↖ tu te sous-estimes</text>
  <text class="zone-label" x="${fmt(px(0.97))}" y="${fmt(py(0.05))}" text-anchor="end">tu te surestimes ↘</text>
  ${dots}
  <text class="axis-title" x="${fmt(px(0.5))}" y="${H - 6}" text-anchor="middle">Confiance (moyenne des LOs notés)</text>
  <text class="axis-title" transform="translate(14 ${fmt(py(0.5))}) rotate(-90)" text-anchor="middle">Réussite au dernier essai</text>
</svg>`;
  }

  // ------------------------------------------------------------------ vue tableau

  /** columns : [{ label, num, nowrap }] ; rows : tableaux de cellules déjà échappées. */
  function table(columns, rows) {
    const cls = (c) => {
      const names = [c.num && "num", c.nowrap && "nowrap"].filter(Boolean);
      return names.length ? ` class="${names.join(" ")}"` : "";
    };
    const th = columns.map((c) => `<th${cls(c)}>${esc(c.label)}</th>`).join("");
    const tr = rows.map((cells) => `<tr>${cells.map((cell, i) => `<td${cls(columns[i])}>${cell}</td>`).join("")}</tr>`);
    return `<div class="table-wrap"><table class="data"><thead><tr>${th}</tr></thead><tbody>${tr.join("")}</tbody></table></div>`;
  }

  FRM.charts = {
    resetTips: () => tips.clear(),
    tip,
    legend,
    radar,
    scoreBars,
    scoreLegendItems,
    stepMap,
    dumbbells,
    lineChart,
    scatter,
    table,
  };
})(window.FRM, window.FRM.ui);
