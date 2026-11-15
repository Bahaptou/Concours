/* Graph view of corpus entries (reading page "Corpus de ce reading", corpus page "Graphe" view):
 * one box per entry (type dot, title, "Livres : 1, 3" from the readings of the notes using it),
 * an arrow from A to B when A cites B (#voir), dotted when A's code imports brick B. Hovering or
 * clicking an entry shows its links: what it cites in dark slate, what cites it in mid slate (the
 * kinds-of-use ramp validated in style.css: never a type colour), the rest fades. Entries linked
 * to the shown ones but outside them (another reading, another filter) can appear pale.
 * Layout: a hand-written force simulation (Fruchterman-Reingold), deterministic, no library. */
(function (FRM, ui) {
  "use strict";

  const { esc } = ui;
  const NODE_W = 196;
  const NODE_H = 46;
  const GAP_X = 34; // room between boxes, in pixels, once laid out
  const GAP_Y = 46;
  const TITLE_CHARS = 25;

  // ------------------------------------------------------------------ graph

  const booksOf = (entry) =>
    [...new Set(entry.readings.map((r) => FRM.findReading(r)).filter(Boolean).map((r) => FRM.bookOf(r).id))].sort((a, b) => a - b);

  /** Nodes (the entries, plus the pale `linked` ones) and links between them. */
  function buildGraph(entries, linked, paleLinks) {
    const nodes = new Map(entries.map((entry) => [entry.id, { entry, ghost: false }]));
    for (const entry of linked) if (!nodes.has(entry.id)) nodes.set(entry.id, { entry, ghost: true });
    const links = [];
    for (const { entry } of nodes.values()) {
      for (const target of entry.cites || []) if (nodes.has(target) && target !== entry.id) links.push({ from: entry.id, to: target, kind: "cite" });
      for (const target of entry.imports || []) if (nodes.has(target) && target !== entry.id) links.push({ from: entry.id, to: target, kind: "import" });
    }
    // One step away, a link between two pale entries says nothing about the shown ones; further, it is the chain.
    return { nodes, links: paleLinks ? links : links.filter((l) => !nodes.get(l.from).ghost || !nodes.get(l.to).ghost) };
  }

  /** Force simulation (Fruchterman-Reingold) of one group of linked nodes, in "box units"
   *  (one box ≈ 1 × 1), then boxes pushed apart until none overlap. Deterministic. */
  function forceLayout(list, pairs) {
    const n = list.length;
    const radius = Math.max(1, Math.sqrt(n));
    list.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n;
      node.x = radius * Math.cos(angle);
      node.y = radius * Math.sin(angle);
    });
    const k = 1.25; // ideal distance between linked boxes
    const steps = 300;
    for (let step = 0; step < steps; step += 1) {
      const temperature = 0.6 * (1 - step / steps) + 0.01;
      for (const node of list) node.dx = node.dy = 0;
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const a = list[i];
          const b = list[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d = Math.hypot(dx, dy);
          if (d < 0.01) {
            dx = 0.01 * (i - j);
            dy = 0.01;
            d = Math.hypot(dx, dy);
          }
          const push = (k * k) / d;
          a.dx += (dx / d) * push;
          a.dy += (dy / d) * push;
          b.dx -= (dx / d) * push;
          b.dy -= (dy / d) * push;
        }
      }
      for (const [a, b] of pairs) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const pull = (d * d) / k;
        a.dx -= (dx / d) * pull;
        a.dy -= (dy / d) * pull;
        b.dx += (dx / d) * pull;
        b.dy += (dy / d) * pull;
      }
      for (const node of list) {
        node.dx -= 0.1 * node.x; // gravity keeps the group compact
        node.dy -= 0.1 * node.y;
        const d = Math.hypot(node.dx, node.dy);
        if (d > 0) {
          node.x += (node.dx / d) * Math.min(d, temperature);
          node.y += (node.dy / d) * Math.min(d, temperature);
        }
      }
    }
    separate(list, false);
  }

  /** Pushes apart any two boxes closer than one box in both directions (box units); vertically
   *  only when the group has just been narrowed to fit the width. */
  function separate(list, verticalOnly) {
    const n = list.length;
    for (let pass = 0; pass < 120; pass += 1) {
      let moved = false;
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const a = list[i];
          const b = list[j];
          const ox = 1 - Math.abs(a.x - b.x);
          const oy = 1 - Math.abs(a.y - b.y);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox < oy && !verticalOnly) {
              const s = (a.x < b.x ? -1 : 1) * (ox / 2 + 0.01);
              a.x += s;
              b.x -= s;
            } else {
              const s = (a.y < b.y ? -1 : 1) * (oy / 2 + 0.01);
              a.y += s;
              b.y -= s;
            }
          }
        }
      }
      if (!moved) break;
    }
  }

  /**
   * Positions in pixels (node.px, node.py: box centres). Each group of linked entries is laid out
   * on its own, then the groups are shelved left to right, largest first, within `width`; the
   * entries linked to nothing form a compact grid at the end. Same input, same picture.
   */
  function layout({ nodes, links }, width) {
    const unitX = NODE_W + GAP_X;
    const unitY = NODE_H + GAP_Y;
    const list = [...nodes.values()].sort((a, b) => a.entry.type.localeCompare(b.entry.type) || a.entry.titre.localeCompare(b.entry.titre, "fr"));
    const byId = new Map(list.map((node) => [node.entry.id, node]));
    const neighbours = new Map(list.map((node) => [node, new Set()]));
    const pairs = links.map((l) => [byId.get(l.from), byId.get(l.to)]);
    for (const [a, b] of pairs) {
      neighbours.get(a).add(b);
      neighbours.get(b).add(a);
    }
    // Groups: linked step by step.
    const seen = new Set();
    const groups = [];
    const singles = [];
    for (const start of list) {
      if (seen.has(start)) continue;
      const group = [];
      const stack = [start];
      while (stack.length) {
        const node = stack.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        group.push(node);
        stack.push(...neighbours.get(node));
      }
      if (group.length === 1) singles.push(group[0]);
      else groups.push(group);
    }
    groups.sort((a, b) => b.length - a.length);
    // Each group in pixels, its top-left corner at (0, 0).
    const blocks = groups.map((group) => {
      const inside = new Set(group);
      forceLayout(group, pairs.filter(([a, b]) => inside.has(a) && inside.has(b)));
      // Too wide for the room: narrow it, then make room vertically (no sideways scrolling).
      const spanX = Math.max(...group.map((n) => n.x)) - Math.min(...group.map((n) => n.x));
      const room = (width - NODE_W) / unitX;
      if (spanX > room && room > 0) {
        const left = Math.min(...group.map((n) => n.x));
        for (const node of group) node.x = left + (node.x - left) * (room / spanX);
        separate(group, true);
      }
      const minX = Math.min(...group.map((n) => n.x));
      const minY = Math.min(...group.map((n) => n.y));
      for (const node of group) {
        node.px = (node.x - minX) * unitX + NODE_W / 2;
        node.py = (node.y - minY) * unitY + NODE_H / 2;
      }
      return {
        nodes: group,
        w: Math.max(...group.map((n) => n.px)) + NODE_W / 2,
        h: Math.max(...group.map((n) => n.py)) + NODE_H / 2,
      };
    });
    if (singles.length) {
      const columns = Math.max(1, Math.min(singles.length, Math.floor((width + GAP_X) / unitX)));
      singles.forEach((node, i) => {
        node.px = (i % columns) * unitX + NODE_W / 2;
        node.py = Math.floor(i / columns) * unitY + NODE_H / 2;
      });
      blocks.push({
        nodes: singles,
        w: Math.min(singles.length, columns) * unitX - GAP_X,
        h: Math.ceil(singles.length / columns) * unitY - GAP_Y,
      });
    }
    // Shelves: blocks side by side while they fit, then a new row.
    const margin = 40;
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const block of blocks) {
      if (x > 0 && x + block.w > width) {
        x = 0;
        y += rowHeight + margin;
        rowHeight = 0;
      }
      for (const node of block.nodes) {
        node.px += x;
        node.py += y;
      }
      x += block.w + margin;
      rowHeight = Math.max(rowHeight, block.h);
    }
  }

  // ------------------------------------------------------------------ drawing

  /** Point where the line from (x1, y1) to (x2, y2) leaves the box centred on (x1, y1). */
  function boxExit(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (!dx && !dy) return [x1, y1];
    const t = Math.min((NODE_W / 2 + 3) / Math.abs(dx || 1e-9), (NODE_H / 2 + 3) / Math.abs(dy || 1e-9));
    return [x1 + dx * t, y1 + dy * t];
  }

  /** Arrow between two boxes. `shift`: sideways offset (pixels), so that two entries citing each
   *  other get two visible arrows instead of one line drawn twice. */
  function edgePath(link, nodes, shift = 0) {
    const a = nodes.get(link.from);
    const b = nodes.get(link.to);
    const length = Math.hypot(b.px - a.px, b.py - a.py) || 1;
    const nx = (-(b.py - a.py) / length) * shift;
    const ny = ((b.px - a.px) / length) * shift;
    const [x1, y1] = boxExit(a.px + nx, a.py + ny, b.px + nx, b.py + ny);
    const [x2, y2] = boxExit(b.px + nx, b.py + ny, a.px + nx, a.py + ny);
    return `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;
  }

  /** Sideways offset of each link: 5 px when the reverse link exists, 0 otherwise. */
  function shiftsOf(links) {
    const keys = new Set(links.map((l) => `${l.from}>${l.to}`));
    return links.map((l) => (keys.has(`${l.to}>${l.from}`) ? 5 : 0));
  }

  const short = (text) => (text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text);

  function nodeSvg(node) {
    const e = node.entry;
    const books = booksOf(e);
    const where = books.length ? `${books.length > 1 ? "Livres" : "Livre"} : ${books.join(", ")}` : "Aucun livre";
    const type = FRM.entryType(e.type).label;
    return `
<g class="gnode etype-${e.type}${node.ghost ? " is-ghost" : ""}" data-gnode="${esc(e.id)}" transform="translate(${(node.px - NODE_W / 2).toFixed(1)},${(node.py - NODE_H / 2).toFixed(1)})" tabindex="0">
  <title>${esc(`${type} · ${e.titre}${node.ghost ? " (entrée liée, en grisé)" : ""} — double-clic pour ouvrir`)}</title>
  <rect class="gbox" width="${NODE_W}" height="${NODE_H}" rx="8"></rect>
  <rect class="gdot" x="10" y="11" width="8" height="8" rx="2"></rect>
  <text class="gtitle" x="24" y="19">${esc(short(e.titre))}</text>
  <text class="gbooks" x="${NODE_W - 9}" y="${NODE_H - 9}" text-anchor="end">${esc(where)}</text>
</g>`;
  }

  // ------------------------------------------------------------------ view

  /**
   * Fills `container` with the graph of `entries`.
   * options.linked: entries linked to them (FRM.linkedTo), drawn pale; options.paleLinks: also draw
   * the links between two pale entries (depth > 1); options.ghostLabel: legend of the pale ones.
   */
  function render(container, entries, { linked = [], paleLinks = false, ghostLabel = "liées aux résultats" } = {}) {
    if (!entries.length) {
      container.innerHTML = `<div class="placeholder">Aucune entrée à afficher.</div>`;
      return;
    }
    const graph = buildGraph(entries, linked, paleLinks);
    // Room for the drawing: the card's width minus a margin.
    layout(graph, Math.max(NODE_W, (container.clientWidth || 900) - 60));
    const all = [...graph.nodes.values()];
    const pad = 16;
    const minX = Math.min(...all.map((n) => n.px)) - NODE_W / 2 - pad;
    const minY = Math.min(...all.map((n) => n.py)) - NODE_H / 2 - pad;
    const width = Math.max(...all.map((n) => n.px)) + NODE_W / 2 + pad - minX;
    const height = Math.max(...all.map((n) => n.py)) + NODE_H / 2 + pad - minY;
    const marker = (id) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"></path></marker>`;
    const ghostCount = all.filter((n) => n.ghost).length;
    graph.shifts = shiftsOf(graph.links);
    // The frame: the drawing's height, within a screen's worth; the view moves inside it (wire).
    const frameHeight = Math.max(240, Math.min(Math.ceil(height), Math.round(window.innerHeight * 0.72)));
    container.innerHTML = `
<div class="graph-legend legend">
  <span class="legend-item"><svg class="key-arrow" viewBox="0 0 30 10"><line x1="1" y1="5" x2="22" y2="5" class="ledge is-cite"></line><path d="M21,1 L29,5 L21,9 z" class="lhead is-cite"></path></svg>cite</span>
  <span class="legend-item"><svg class="key-arrow" viewBox="0 0 30 10"><line x1="1" y1="5" x2="22" y2="5" class="ledge is-cited"></line><path d="M21,1 L29,5 L21,9 z" class="lhead is-cited"></path></svg>citée par</span>
  <span class="legend-item"><svg class="key-arrow" viewBox="0 0 30 10"><line x1="1" y1="5" x2="28" y2="5" class="ledge is-import"></line></svg>import de code</span>
  ${ghostCount ? `<span class="legend-item"><span class="key rect key-ghost"></span>${esc(ghostLabel)} (${ghostCount})</span>` : ""}
  <span class="legend-item muted">Glisse le fond pour te déplacer, molette pour zoomer ; clique une entrée pour la garder en vue, glisse-la pour la déplacer, double-clic pour l'ouvrir.</span>
</div>
<div class="graph-wrap" style="height:${frameHeight}px">
  <div class="graph-controls" role="group" aria-label="Zoom">
    <button type="button" data-graph-zoom="in" title="Zoomer">＋</button>
    <button type="button" data-graph-zoom="out" title="Dézoomer">－</button>
    <button type="button" data-graph-zoom="fit" title="Voir tout le graphe">Tout voir</button>
    <button type="button" data-graph-zoom="real" title="Revenir à la taille réelle">1:1</button>
    <span class="graph-scale" data-graph-scale></span>
  </div>
  <svg class="corpus-graph" role="img" aria-label="Graphe des liens entre ${entries.length} entrées">
    <defs>${marker("garrow")}${marker("garrow-cite")}${marker("garrow-cited")}</defs>
    <g class="gedges">${graph.links.map((l, i) => `<path class="gedge${l.kind === "import" ? " is-import" : ""}" data-gedge="${i}" d="${edgePath(l, graph.nodes, graph.shifts[i])}" marker-end="url(#garrow)"></path>`).join("")}</g>
    <g class="gnodes">${all.map(nodeSvg).join("")}</g>
  </svg>
</div>
<div class="graph-info small" data-graph-info></div>`;
    wire(container, graph, { x: minX, y: minY, width, height });
  }

  // ------------------------------------------------------------------ interaction

  function wire(container, graph, bounds) {
    const svg = container.querySelector("svg.corpus-graph");
    const wrap = container.querySelector(".graph-wrap");
    const info = container.querySelector("[data-graph-info]");
    const edges = [...svg.querySelectorAll("[data-gedge]")];
    let pinned = null;

    // Preview card of the box under the pointer (entry-preview.js).
    const preview = FRM.entryPreview.create(container);

    // ---------------------------------------------------------- the view: like a map
    // Drag the background to move, wheel (or double-click the background) to zoom around the
    // pointer (choice of Baptiste, 2026-10-07). The camera is the drawing point at the centre of
    // the frame and a scale (1 = real size); the SVG's viewBox follows it, and the frame's size.
    const MIN_SCALE = 0.15;
    const MAX_SCALE = 3;
    const scaleLabel = container.querySelector("[data-graph-scale]");
    let cam;
    const frame = () => ({ w: wrap.clientWidth || 1, h: wrap.clientHeight || 1 });
    const clampScale = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

    function apply() {
      const { w, h } = frame();
      const vw = w / cam.scale;
      const vh = h / cam.scale;
      svg.setAttribute("viewBox", `${(cam.cx - vw / 2).toFixed(2)} ${(cam.cy - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
      scaleLabel.textContent = `${Math.round(cam.scale * 100)} %`;
    }
    /** Zooms to `scale`, the drawing point (px, py) staying under the pointer. */
    function zoomAt(scale, px, py) {
      const s = clampScale(scale);
      cam = { cx: px - ((px - cam.cx) * cam.scale) / s, cy: py - ((py - cam.cy) * cam.scale) / s, scale: s };
      apply();
      preview.hide();
    }
    /** Real size: the drawing centred across, its top at the top (centred when it fits). */
    function realSize() {
      const { h } = frame();
      cam = { cx: bounds.x + bounds.width / 2, cy: bounds.height <= h ? bounds.y + bounds.height / 2 : bounds.y + h / 2, scale: 1 };
      apply();
    }
    /** The whole drawing in the frame, never larger than real size. */
    function fitAll() {
      const { w, h } = frame();
      cam = { cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2, scale: clampScale(Math.min(1, w / bounds.width, h / bounds.height)) };
      apply();
    }
    /** A point of the window (clientX, clientY) in drawing units. */
    function toDrawing(clientX, clientY) {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    }
    realSize();
    new ResizeObserver(apply).observe(wrap);
    // The frame never scrolls (the browser scrolls a focused box into view): the camera moves instead.
    wrap.addEventListener("scroll", () => {
      wrap.scrollTop = 0;
      wrap.scrollLeft = 0;
    });

    svg.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault(); // the wheel zooms the graph instead of scrolling the page
        const at = toDrawing(event.clientX, event.clientY);
        const step = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY; // lines -> pixels
        zoomAt(cam.scale * Math.exp(-step * 0.0015), at.x, at.y);
      },
      { passive: false }
    );
    container.querySelector(".graph-controls").addEventListener("click", (event) => {
      const button = event.target.closest("[data-graph-zoom]");
      if (!button) return;
      const kind = button.dataset.graphZoom;
      if (kind === "in" || kind === "out") zoomAt(cam.scale * (kind === "in" ? 1.3 : 1 / 1.3), cam.cx, cam.cy);
      else if (kind === "fit") fitAll();
      else realSize();
    });

    // Drag of the background: moves the view; a press without movement is a click, which releases
    // the pinned entry (a click beside the boxes, on the background or an arrow).
    let pan = null;

    const titleLink = (id) => {
      const e = FRM.findEntry(id);
      return e ? `<a href="${ui.entryHref(e)}">${esc(e.titre)}</a>` : esc(id);
    };

    function focus(id) {
      svg.classList.toggle("has-focus", Boolean(id));
      svg.querySelectorAll("[data-gnode]").forEach((g) => g.classList.remove("is-focus", "is-near"));
      edges.forEach((edge) => {
        edge.classList.remove("is-cite", "is-cited");
        edge.setAttribute("marker-end", "url(#garrow)");
      });
      if (!id) {
        info.innerHTML = "";
        return;
      }
      svg.querySelector(`[data-gnode="${CSS.escape(id)}"]`)?.classList.add("is-focus");
      const out = [];
      const into = [];
      graph.links.forEach((link, i) => {
        if (link.from !== id && link.to !== id) return;
        const outgoing = link.from === id;
        const edge = edges[i];
        edge.classList.add(outgoing ? "is-cite" : "is-cited");
        edge.setAttribute("marker-end", `url(#${outgoing ? "garrow-cite" : "garrow-cited"})`);
        const other = outgoing ? link.to : link.from;
        svg.querySelector(`[data-gnode="${CSS.escape(other)}"]`)?.classList.add("is-near");
        (outgoing ? out : into).push(`${titleLink(other)}${link.kind === "import" ? " (import)" : ""}`);
      });
      const entry = FRM.findEntry(id);
      info.innerHTML = `<strong>${titleLink(id)}</strong>${entry ? ` · ${esc(FRM.entryType(entry.type).label)}` : ""}
        · <span class="ginfo-cite">cite</span> : ${out.join(", ") || "rien"}
        · <span class="ginfo-cited">citée par</span> : ${into.join(", ") || "personne"}${pinned ? ` <span class="muted">(clic sur la bulle ou à côté pour relâcher)</span>` : ""}`;
    }

    // Drag of a box: moves it and its arrows; a press without movement is a click (pin / unpin).
    let drag = null;
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const g = event.target.closest("[data-gnode]");
      if (!g) {
        pan = { x: event.clientX, y: event.clientY, cx: cam.cx, cy: cam.cy, moved: false };
        svg.setPointerCapture(event.pointerId);
        return;
      }
      const start = toDrawing(event.clientX, event.clientY);
      const node = graph.nodes.get(g.dataset.gnode);
      drag = { g, node, start, origin: { x: node.px, y: node.py }, moved: false };
      g.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (pan) {
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        if (!pan.moved && Math.hypot(dx, dy) < 4) return;
        if (!pan.moved) {
          pan.moved = true;
          svg.classList.add("is-panning");
          preview.hide();
        }
        cam = { ...cam, cx: pan.cx - dx / cam.scale, cy: pan.cy - dy / cam.scale };
        apply();
        return;
      }
      if (!drag) {
        const g = event.target.closest("[data-gnode]");
        if (!pinned) focus(g ? g.dataset.gnode : null);
        preview.hover(g, g && g.dataset.gnode);
        return;
      }
      preview.hide();
      const at = toDrawing(event.clientX, event.clientY);
      const dx = at.x - drag.start.x;
      const dy = at.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      drag.node.px = drag.origin.x + dx;
      drag.node.py = drag.origin.y + dy;
      drag.g.setAttribute("transform", `translate(${(drag.node.px - NODE_W / 2).toFixed(1)},${(drag.node.py - NODE_H / 2).toFixed(1)})`);
      graph.links.forEach((link, i) => {
        if (link.from === drag.node.entry.id || link.to === drag.node.entry.id) edges[i].setAttribute("d", edgePath(link, graph.nodes, graph.shifts[i]));
      });
    });
    svg.addEventListener("pointerup", () => {
      if (pan) {
        if (!pan.moved && pinned) {
          pinned = null;
          focus(null);
        }
        pan = null;
        svg.classList.remove("is-panning");
        return;
      }
      const clicked = drag && !drag.moved ? drag.g : null;
      if (clicked) {
        const id = drag.node.entry.id;
        pinned = pinned === id ? null : id;
        focus(pinned || id);
      }
      drag = null;
      if (clicked) preview.silence(clicked.dataset.gnode);
    });
    svg.addEventListener("pointerleave", () => {
      if (!pinned && !drag) focus(null);
      preview.hover(null);
    });
    svg.addEventListener("dblclick", (event) => {
      const g = event.target.closest("[data-gnode]");
      if (!g) {
        const at = toDrawing(event.clientX, event.clientY);
        return zoomAt(cam.scale * 1.6, at.x, at.y); // the background: zoom in there
      }
      const entry = FRM.findEntry(g.dataset.gnode);
      if (entry) location.href = ui.entryHref(entry);
    });
    svg.addEventListener("keydown", (event) => {
      const g = event.target.closest("[data-gnode]");
      if (!g) return;
      if (event.key === "Enter") location.href = ui.entryHref(FRM.findEntry(g.dataset.gnode));
      if (event.key === " ") {
        event.preventDefault();
        pinned = pinned === g.dataset.gnode ? null : g.dataset.gnode;
        focus(pinned);
      }
    });
    svg.addEventListener("focusin", (event) => {
      const g = event.target.closest("[data-gnode]");
      if (!g) return;
      // Reached with the keyboard outside the frame: the view comes to it.
      const box = g.getBoundingClientRect();
      const room = wrap.getBoundingClientRect();
      if (box.left < room.left || box.right > room.right || box.top < room.top || box.bottom > room.bottom) {
        const node = graph.nodes.get(g.dataset.gnode);
        cam = { ...cam, cx: node.px, cy: node.py };
        apply();
      }
      if (!pinned) focus(g.dataset.gnode);
    });
  }

  FRM.corpusGraph = { render };
})(window.FRM, window.FRM.ui);
